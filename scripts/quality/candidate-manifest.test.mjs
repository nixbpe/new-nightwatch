import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

function run(command, cwd) {
  return Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
}

const testNonUtf8Path = process.platform === "darwin" ? test.skip : test;

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "candidate-manifest-"));
  roots.push(root);
  run(["git", "init", "-q"], root);
  run(["git", "config", "user.email", "test@nightwatch.invalid"], root);
  run(["git", "config", "user.name", "NightWatch Test"], root);
  await writeFile(path.join(root, "tracked.txt"), "before\n");
  run(["git", "add", "tracked.txt"], root);
  run(["git", "commit", "-qm", "baseline"], root);
  await writeFile(path.join(root, "tracked.txt"), "after\n");
  await writeFile(path.join(root, "untracked.txt"), "new\n");
  return root;
}

function manifest(root, ...args) {
  return run(
    ["bun", path.resolve(import.meta.dir, "candidate-manifest.mjs"), ...args],
    root,
  );
}

function parse(result) {
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString());
}

describe("candidate manifest", () => {
  test("discovers tracked and untracked files deterministically", async () => {
    const root = await repository();
    const first = manifest(root);
    const second = manifest(root);
    expect(first.stdout.toString()).toBe(second.stdout.toString());
    expect(parse(first).files.map((file) => [file.path, file.state])).toEqual([
      ["tracked.txt", "modified"],
      ["untracked.txt", "untracked"],
    ]);
  });

  test("records tracked deletion explicitly", async () => {
    const root = await repository();
    await unlink(path.join(root, "tracked.txt"));
    const result = parse(manifest(root));
    expect(result.files.find((file) => file.path === "tracked.txt")).toEqual({
      path: "tracked.txt",
      state: "deleted",
      kind: "file",
      mode: null,
      sha256: null,
    });
  });

  test("records staged rename as deletion and addition", async () => {
    const root = await repository();
    run(["git", "mv", "tracked.txt", "renamed.txt"], root);
    run(["git", "add", "renamed.txt"], root);
    const result = parse(manifest(root));
    expect(result.files.map((file) => [file.path, file.state])).toEqual([
      ["renamed.txt", "added"],
      ["tracked.txt", "deleted"],
      ["untracked.txt", "untracked"],
    ]);
  });

  test("rejects staged content that differs from the worktree", async () => {
    const root = await repository();
    const tracked = path.join(root, "tracked.txt");
    await writeFile(tracked, "staged-a\n");
    run(["git", "add", "tracked.txt"], root);
    await writeFile(tracked, "before\n");
    const result = manifest(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "index differs from worktree for staged path: tracked.txt",
    );
  });

  test("changes aggregate digest for mode and content changes", async () => {
    const root = await repository();
    const first = parse(manifest(root));
    const firstEntry = first.files.find((file) => file.path === "tracked.txt");
    await chmod(path.join(root, "tracked.txt"), 0o755);
    const second = parse(manifest(root));
    const secondEntry = second.files.find(
      (file) => file.path === "tracked.txt",
    );
    expect(secondEntry.sha256).toBe(firstEntry.sha256);
    expect(secondEntry.mode).not.toBe(firstEntry.mode);
    expect(second.manifestSha256).not.toBe(first.manifestSha256);

    await writeFile(path.join(root, "tracked.txt"), "different\n");
    const third = parse(manifest(root));
    const thirdEntry = third.files.find((file) => file.path === "tracked.txt");
    expect(thirdEntry.sha256).not.toBe(secondEntry.sha256);
    expect(third.manifestSha256).not.toBe(second.manifestSha256);
  });

  test("distinguishes dangling symlink targets in candidate bindings", async () => {
    const root = await repository();
    const link = path.join(root, "dangling-link");
    await symlink("missing-target-a", link);
    const first = parse(manifest(root));
    const firstEntry = first.files.find(
      (file) => file.path === "dangling-link",
    );
    expect(firstEntry).toMatchObject({ state: "untracked", kind: "symlink" });

    await unlink(link);
    await symlink("missing-target-b", link);
    const second = parse(manifest(root));
    const secondEntry = second.files.find(
      (file) => file.path === "dangling-link",
    );
    expect(secondEntry.sha256).not.toBe(firstEntry.sha256);
    expect(second.manifestSha256).not.toBe(first.manifestSha256);
  });

  test("distinguishes non-UTF-8 symlink target bytes", async () => {
    const root = await repository();
    const link = path.join(root, "byte-link");
    await symlink(Buffer.from([0xff]), link);
    const first = parse(manifest(root));
    const firstEntry = first.files.find((file) => file.path === "byte-link");

    await unlink(link);
    await symlink(Buffer.from([0xfe]), link);
    const second = parse(manifest(root));
    const secondEntry = second.files.find((file) => file.path === "byte-link");
    expect(secondEntry.sha256).not.toBe(firstEntry.sha256);
    expect(second.manifestSha256).not.toBe(first.manifestSha256);
  });

  test("rejects omitted discovered paths", async () => {
    const root = await repository();
    const result = manifest(root, "tracked.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "omits discovered paths: untracked.txt",
    );
  });

  test("records ambient exclusions as non-candidate paths", async () => {
    const root = await repository();
    const result = parse(
      manifest(
        root,
        "tracked.txt",
        "--exclude",
        "untracked.txt=user-owned ambient file",
      ),
    );
    expect(result.nonCandidateExclusions).toEqual([
      { path: "untracked.txt", reason: "user-owned ambient file" },
    ]);
    expect(result).not.toHaveProperty("excluded");
  });

  test("orders exclusions by normalized code units", async () => {
    const root = await repository();
    await writeFile(path.join(root, "z.txt"), "z\n");
    await writeFile(path.join(root, "ä.txt"), "a-umlaut\n");
    const result = parse(
      manifest(root, "--exclude", "ä.txt=second", "--exclude", "z.txt=first"),
    );
    expect(result.nonCandidateExclusions).toEqual([
      { path: "z.txt", reason: "first" },
      { path: "ä.txt", reason: "second" },
    ]);
  });

  test("rejects missing option values and unknown options", async () => {
    const root = await repository();
    for (const [args, message] of [
      [["--base"], "--base requires a value"],
      [["--from"], "--from requires a value"],
      [["--exclude"], "--exclude requires a value"],
      [["--unknown"], "unknown option: --unknown"],
    ]) {
      const result = manifest(root, ...args);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(message);
    }
  });

  test("rejects C0 and DEL control characters in candidate paths", async () => {
    for (const name of [
      "tab\tpath.txt",
      "escape\u001bpath.txt",
      "delete\u007fpath.txt",
    ]) {
      const root = await repository();
      await writeFile(path.join(root, name), "ambiguous\n");
      const result = manifest(root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        "candidate path contains a forbidden control character",
      );
    }
  });

  testNonUtf8Path("fails closed on non-UTF-8 Git paths", async () => {
    const root = await repository();
    const invalidPath = Buffer.concat([
      Buffer.from(`${root}${path.sep}`),
      Buffer.from([0xff]),
    ]);
    await writeFile(invalidPath, "invalid utf-8 path\n");
    const result = manifest(root);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
  });
});
