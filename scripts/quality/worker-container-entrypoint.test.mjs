import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nw-worker-entrypoint-"));
  await copyFile(
    new URL("../../apps/worker/docker/worker-entrypoint.mjs", import.meta.url),
    join(directory, "worker-entrypoint.mjs"),
  );
  await mkdir(join(directory, "dist"));
  await writeFile(
    join(directory, "dist/index.js"),
    "console.log(JSON.stringify({ initialized: true, pid: process.pid, nodeEnv: process.env.NODE_ENV }));\n",
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function launch(nodeEnv, args = [], overrides = {}) {
  const env = { ...process.env, ...overrides };
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  const child = Bun.spawn(
    [process.execPath, join(directory, "worker-entrypoint.mjs"), ...args],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr, pid: child.pid };
}

const unsetMessage =
  "nightwatch-worker: NODE_ENV is unset; refusing to start. Set NODE_ENV=production.\n";
const refusedMessage =
  "nightwatch-worker: NODE_ENV must be production; refusing to start.\n";

test("worker-entrypoint imports the production bundle in the launcher PID", async () => {
  const result = await launch("production");
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    initialized: true,
    pid: result.pid,
    nodeEnv: "production",
  });
});

test.each([
  [undefined, unsetMessage],
  ["", unsetMessage],
  ["development", refusedMessage],
  ["test", refusedMessage],
])(
  "worker-entrypoint refuses NODE_ENV=%s before importing",
  async (nodeEnv, message) => {
    const result = await launch(nodeEnv);
    expect(result.code).toBe(78);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(message);
  },
);

test("worker-entrypoint ignores command arguments instead of dispatching them", async () => {
  const result = await launch("production", ["-e", "process.exit(99)"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).initialized).toBe(true);
});

test("worker-entrypoint refuses a runtime development-flavor environment bypass", async () => {
  const result = await launch("development", [], {
    WORKER_ALLOW_DEVELOPMENT: "1",
  });
  expect(result.code).toBe(78);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(refusedMessage);
});
