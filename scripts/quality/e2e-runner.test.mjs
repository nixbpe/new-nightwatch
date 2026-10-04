import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function run(overrides = {}, args = []) {
  const root = await mkdtemp(join(tmpdir(), "nw-e2e-runner-"));
  roots.push(root);
  const log = join(root, "commands.jsonl");
  const fake = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const keys = ["DATABASE_URL", "DATABASE_OWNER_URL", "REDIS_URL", "REDIS_KEY_PREFIX", "WEB_PORT", "API_PORT", "APP_URL", "BETTER_AUTH_URL", "CORS_ORIGIN", "SMTP_PORT", "OUTBOUND_TEST_ALLOWED_HOSTS", "E2E_EMAIL", "E2E_PASSWORD", "E2E_REQUIRE_CREDENTIALS"];
appendFileSync(process.env.MOCK_LOG, JSON.stringify({ name, args, env: Object.fromEntries(keys.map((key) => [key, process.env[key]])) }) + "\\n");
const stage = name === "node" ? "browser" : args[0] === "run" ? args[1] : args[0] === "apps/api/src/operator/provision-e2e-fixture.ts" ? "fixture" : args[1];
if (stage === process.env.MOCK_FAIL) process.exit(1);
if (stage === "prepare") {
  const database = args[2];
  console.log(JSON.stringify({DATABASE_URL: "postgres://nightwatch@dev/" + database, DATABASE_OWNER_URL: "postgres://nightwatch_owner@dev/" + database, REDIS_URL: process.env.REDIS_URL, REDIS_KEY_PREFIX: database}));
}
if (name === "node" && process.env.MOCK_INTERRUPT === "1") process.kill(process.ppid, "SIGTERM");
if (name === "docker") process.exit(1);
`;
  for (const name of ["docker", "bun", "node"])
    await writeFile(join(root, name), fake, { mode: 0o755 });
  const child = Bun.spawn(
    [process.execPath, resolve("scripts/e2e.mjs"), ...args],
    {
      env: {
        ...process.env,
        CI: "",
        E2E_EXTERNAL_SERVICES: "",
        PATH: `${root}:${process.env.PATH}`,
        MOCK_LOG: log,
        DATABASE_URL: "postgres://dev/runtime",
        DATABASE_OWNER_URL: "postgres://dev/owner",
        REDIS_URL: "redis://dev:6379",
        SMTP_PORT: "11025",
        OUTBOUND_TEST_ALLOWED_HOSTS: "target.nw-test.internal",
        ...overrides,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const code = await child.exited;
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { code, calls };
}

test("local runs share services with distinct database and Redis namespaces", async () => {
  const first = await run({}, ["--grep", "first result"]);
  const second = await run();
  expect(first.code).toBe(0);
  expect(second.code).toBe(0);
  const setup = first.calls.filter((call) => call.args[0] === "run");
  expect(setup.map((call) => call.args[1])).toEqual([
    "db:migrate",
    "db:partitions",
  ]);
  const prepare = first.calls[0];
  const cleanup = first.calls.at(-1);
  expect(prepare.args.slice(0, 2)).toEqual([
    "scripts/e2e-database.mjs",
    "prepare",
  ]);
  expect(cleanup.args).toEqual([
    "scripts/e2e-database.mjs",
    "cleanup",
    prepare.args[2],
  ]);
  expect(second.calls[0].args[2]).not.toBe(prepare.args[2]);
  const browser = first.calls.find((call) => call.name === "node");
  expect(browser.args.slice(-2)).toEqual(["--grep", "first result"]);
  expect(browser.env.DATABASE_URL).toBe(
    `postgres://nightwatch@dev/${prepare.args[2]}`,
  );
  expect(browser.env.DATABASE_OWNER_URL).toBe(
    `postgres://nightwatch_owner@dev/${prepare.args[2]}`,
  );
  expect(browser.env.REDIS_URL).toBe("redis://dev:6379");
  expect(browser.env.REDIS_KEY_PREFIX).toBe(prepare.args[2]);
  expect(browser.env.E2E_EMAIL).toBe(
    `settings-${prepare.args[2]}@nightwatch.invalid`,
  );
  expect(browser.env.E2E_REQUIRE_CREDENTIALS).toBe("1");
  const fixture = first.calls.find(
    (call) => call.args[0] === "apps/api/src/operator/provision-e2e-fixture.ts",
  );
  expect(fixture.env.DATABASE_OWNER_URL).toBe(browser.env.DATABASE_OWNER_URL);
  expect(fixture.env.E2E_EMAIL).toBe(browser.env.E2E_EMAIL);
  expect(fixture.env.E2E_PASSWORD).toBe(browser.env.E2E_PASSWORD);
  expect(
    second.calls.find((call) => call.name === "node").env.E2E_PASSWORD,
  ).not.toBe(browser.env.E2E_PASSWORD);
  for (const call of setup)
    expect(call.env.DATABASE_OWNER_URL).toBe(browser.env.DATABASE_OWNER_URL);
  expect(browser.env.SMTP_PORT).toBe("11025");
  expect(browser.env.APP_URL).toBe(`http://localhost:${browser.env.WEB_PORT}`);
  expect(browser.env.CORS_ORIGIN).toBe(browser.env.APP_URL);
  expect(browser.env.BETTER_AUTH_URL).toBe(
    `http://localhost:${browser.env.API_PORT}`,
  );
  expect(browser.env.API_PORT).not.toBe(browser.env.WEB_PORT);
  expect(browser.env.OUTBOUND_TEST_ALLOWED_HOSTS).toBe(
    "target.nw-test.internal",
  );
});

for (const overrides of [{ CI: "true" }, { E2E_EXTERNAL_SERVICES: "1" }]) {
  test(`external services remain caller-owned ${JSON.stringify(overrides)}`, async () => {
    const result = await run(overrides);
    expect(result.code).toBe(0);
    expect(result.calls.map((call) => call.name)).toEqual(["node"]);
    expect(result.calls[0].env.DATABASE_URL).toBe("postgres://dev/runtime");
    expect(result.calls[0].env.REDIS_URL).toBe("redis://dev:6379");
  });
}

for (const stage of [
  "prepare",
  "db:migrate",
  "db:partitions",
  "fixture",
  "browser",
]) {
  test(`cleans only its namespace after ${stage} failure`, async () => {
    const result = await run({ MOCK_FAIL: stage });
    expect(result.code).toBe(1);
    expect(result.calls.at(-1).args).toEqual([
      "scripts/e2e-database.mjs",
      "cleanup",
      result.calls[0].args[2],
    ]);
  });
}

test("interruptions clean the owned namespace and return a nonzero status", async () => {
  const result = await run({ MOCK_INTERRUPT: "1" });
  expect(result.code).toBe(130);
  expect(result.calls.at(-1).args).toEqual([
    "scripts/e2e-database.mjs",
    "cleanup",
    result.calls[0].args[2],
  ]);
});
