import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "verification-scripts-"));
  roots.push(root);
  const secrets = path.join(root, "secrets.json");
  const log = path.join(root, "capture.log");
  writeFileSync(
    secrets,
    JSON.stringify({
      secrets: ["known-credential", "encoded%2Fcredential"],
      hidden: ["query-visible"],
    }),
  );
  writeFileSync(log, "request completed without sensitive values\n");
  return { secrets, log };
}
function scan(args, secretsOnly = false) {
  return Bun.spawnSync(
    [
      process.execPath,
      path.resolve(import.meta.dir, "../../e2e/verification/scan-logs.ts"),
      ...args,
    ],
    {
      env: { ...process.env, SECRETS_ONLY: secretsOnly ? "1" : "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

test("scan-logs rejects malformed invocation and missing capture", () => {
  const { secrets, log } = fixture();
  for (const args of [
    [],
    ["@@"],
    [secrets, log],
    [secrets, "@@"],
    ["@@", log],
    [secrets, "@@", "@@", log],
  ]) {
    const result = scan(args);
    expect(result.exitCode, JSON.stringify(args)).toBe(2);
    expect(result.stderr.toString()).toContain("Usage:");
  }
  writeFileSync(log, "");
  expect(scan([secrets, "@@", log]).exitCode).toBe(2);
});

test("scan-logs accepts nonempty clean capture and rejects exact, encoded and prefix leaks without echoing values", () => {
  const { secrets, log } = fixture();
  const args = [secrets, "@@", log];
  const clean = scan(args);
  expect(clean.exitCode).toBe(0);
  expect(clean.stdout.toString()).toContain("files: 1");
  expect(clean.stdout.toString()).toContain("hits: 0");
  for (const value of [
    "known-credential",
    "encoded%2Fcredential",
    "matrix-token-1234abcd",
  ]) {
    writeFileSync(log, `request leaked ${value}\n`);
    const result = scan(args);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("hits: 1");
    expect(result.stdout.toString() + result.stderr.toString()).not.toContain(
      value,
    );
  }
});

test("scan-logs SECRETS_ONLY permits config-visible values but still rejects secrets", () => {
  const { secrets, log } = fixture();
  const args = [secrets, "@@", log];
  writeFileSync(log, "query-visible qval-1234abcd bodyval-1234abcd\n");
  expect(scan(args).exitCode).toBe(1);
  expect(scan(args, true).exitCode).toBe(0);
  writeFileSync(log, "known-credential\n");
  expect(scan(args, true).exitCode).toBe(1);
});
