import { expect, test } from "bun:test";
import { isolatedMonitorDatabaseUrl } from "../../e2e/support/monitor-checks.ts";

const name = `nw_e2e_${"a".repeat(32)}`;
const local = {
  DATABASE_URL: `postgres://nightwatch:disposable@127.0.0.1:5400/${name}`,
  REDIS_URL: "redis://127.0.0.1:6380",
  REDIS_KEY_PREFIX: name,
};
const ci = {
  DATABASE_URL: "postgres://nightwatch:disposable@localhost:5432/nightwatch",
  REDIS_URL: "redis://localhost:6379",
  CI: "true",
  GITHUB_ACTIONS: "true",
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "ci",
  E2E_REQUIRE_CREDENTIALS: "1",
};

test("monitor-checks permits the local run namespace and dedicated CI service", () => {
  expect(isolatedMonitorDatabaseUrl(local)).toBe(local.DATABASE_URL);
  expect(isolatedMonitorDatabaseUrl(ci)).toBe(ci.DATABASE_URL);
});

test.each([
  [
    "ambient database",
    { DATABASE_URL: local.DATABASE_URL.replace(name, "nightwatch") },
  ],
  [
    "owner role",
    {
      DATABASE_URL: local.DATABASE_URL.replace(
        "nightwatch:",
        "nightwatch_owner:",
      ),
    },
  ],
  [
    "remote database",
    { DATABASE_URL: local.DATABASE_URL.replace("127.0.0.1", "db.example.com") },
  ],
  ["remote Redis", { REDIS_URL: "redis://cache.example.com:6379" }],
  ["wrong namespace", { REDIS_KEY_PREFIX: "nw_e2e_other" }],
  ["missing namespace", { REDIS_KEY_PREFIX: undefined }],
  ["production", { NODE_ENV: "production" }],
])("monitor-checks refuses %s before connecting", (_label, overrides) => {
  expect(() =>
    isolatedMonitorDatabaseUrl({ ...local, ...overrides }),
  ).toThrow();
});

test.each([
  ["CI flag alone", { GITHUB_ACTIONS: undefined }],
  ["non-CI key", { CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: "dev" }],
  ["unprovisioned fixtures", { E2E_REQUIRE_CREDENTIALS: undefined }],
  [
    "different service",
    { DATABASE_URL: ci.DATABASE_URL.replace(":5432", ":5400") },
  ],
])(
  "monitor-checks leaves unrecognized CI services on natural cadence with %s",
  (_label, overrides) => {
    expect(isolatedMonitorDatabaseUrl({ ...ci, ...overrides })).toBe(null);
  },
);

test("monitor-checks requires explicit external-service mode before falling back", () => {
  expect(() => isolatedMonitorDatabaseUrl({ ...ci, CI: undefined })).toThrow();
});

test("monitor-checks refuses production even in external-service mode", () => {
  expect(() =>
    isolatedMonitorDatabaseUrl({ ...ci, NODE_ENV: "production" }),
  ).toThrow();
});

test("external services keep natural scheduling without opening a helper connection", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { driveMonitorChecks } from "./e2e/support/monitor-checks.ts";
     console.log(await driveMonitorChecks(
       { tenantId: "unreached", projectId: "unreached", monitorId: "unreached" },
       () => { throw new Error("predicate must not run"); }, 1));`,
    ],
    {
      env: {
        ...process.env,
        CI: "",
        NODE_ENV: "test",
        E2E_EXTERNAL_SERVICES: "1",
        DATABASE_URL:
          "postgres://nightwatch:disposable@127.0.0.1:1/nightwatch_e2e",
        REDIS_URL: "redis://127.0.0.1:1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toBe("null\n");
  expect(await new Response(child.stderr).text()).toBe("");
});

test("monitor-checks rejects database URL options that can override the guarded target", () => {
  expect(() =>
    isolatedMonitorDatabaseUrl({
      ...local,
      DATABASE_URL: `${local.DATABASE_URL}?database=nightwatch`,
    }),
  ).toThrow();
});
