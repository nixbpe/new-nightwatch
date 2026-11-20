import { afterEach, expect, test } from "bun:test";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildLocalComposeUrls } from "../dev-env.mjs";

const secrets = {
  NW_OWNER_PASSWORD: "owner%40pw",
  NW_DB_PASSWORD: "runtime+pw",
};
const urls = {
  ownerUrl: "postgres://nightwatch_owner:owner%40pw@127.0.0.1:5457/nightwatch",
  runtimeUrl: "postgres://nightwatch:runtime+pw@127.0.0.1:5457/nightwatch",
  redisUrl: "redis://127.0.0.1:6380",
};

test("buildLocalComposeUrls preserves literal credentials, roles and resolved ports", () => {
  expect(buildLocalComposeUrls(secrets, { slot: 0, dbPort: 5457 })).toEqual(
    urls,
  );
  expect(buildLocalComposeUrls(secrets, { slot: 37, dbPort: 54321 })).toEqual({
    ownerUrl:
      "postgres://nightwatch_owner:owner%40pw@127.0.0.1:54321/nightwatch",
    runtimeUrl: "postgres://nightwatch:runtime+pw@127.0.0.1:54321/nightwatch",
    redisUrl: "redis://127.0.0.1:6417",
  });
});

const missingPasswords = ["NW_OWNER_PASSWORD", "NW_DB_PASSWORD"].flatMap(
  (key) => [undefined, ""].map((value) => ({ key, value })),
);
test("buildLocalComposeUrls does not normalize nonblank passwords", () => {
  expect(
    buildLocalComposeUrls(
      { NW_OWNER_PASSWORD: " owner ", NW_DB_PASSWORD: " runtime " },
      { slot: 0, dbPort: 5457 },
    ),
  ).toEqual({
    ownerUrl: "postgres://nightwatch_owner: owner @127.0.0.1:5457/nightwatch",
    runtimeUrl: "postgres://nightwatch: runtime @127.0.0.1:5457/nightwatch",
    redisUrl: "redis://127.0.0.1:6380",
  });
});

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(generatedSecrets = secrets) {
  const root = await mkdtemp(join(tmpdir(), "nw-compose-targets-"));
  roots.push(root);
  for (const dir of [
    ".git",
    "scripts",
    "packages/db/src",
    "apps/api/src/operator",
    "apps/api/src/rate-limit",
  ])
    await mkdir(join(root, dir), { recursive: true });
  for (const file of ["dev-env", "ports", "env-file", "seed", "e2e-database"]) {
    await copyFile(
      resolve(`scripts/${file}.mjs`),
      join(root, `scripts/${file}.mjs`),
    );
  }
  if (generatedSecrets !== null) {
    await writeFile(
      join(root, ".env.compose.local"),
      Object.entries(generatedSecrets)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}="${value}"`)
        .join("\n"),
    );
  }
  // Private dependency copies record the first DB/seed/Redis boundary. They
  // never load database drivers, connect to services or write application data.
  const sentinel = `import { appendFileSync } from "node:fs";
const record = (...args) => appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + "\\n");\n`;
  await writeFile(
    join(root, "packages/db/src/index.ts"),
    `${sentinel}
export function createDatabase(url) { record("createDatabase", url); throw new Error("DB_SENTINEL"); }
export function listMigrations() { record("listMigrations"); throw new Error("MIGRATIONS_SENTINEL"); }
`,
  );
  await writeFile(
    join(root, "apps/api/src/rate-limit/redis.ts"),
    `${sentinel}
export function createRedisClient(url) { record("createRedisClient", url); throw new Error("REDIS_SENTINEL"); }
`,
  );
  await writeFile(
    join(root, "apps/api/src/operator/seed.ts"),
    `${sentinel}
export function readSeedConfig(env, ownerUrl, runtimeUrl) { record("readSeedConfig", env.DATABASE_OWNER_URL, env.DATABASE_URL, ownerUrl, runtimeUrl); return {ownerUrl, runtimeUrl}; }
export async function seedLocalDemo(...urls) { record("seedLocalDemo", ...urls); }
`,
  );
  return root;
}

async function run(root, args, overrides = {}) {
  const log = join(root, "calls.jsonl");
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      MOCK_LOG: log,
      NW_DB_PORT: "5457",
      ...overrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const calls = await access(log).then(
    async () =>
      (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse),
    () => [],
  );
  return { code, stdout, stderr, calls };
}

const resolveArgs = [
  "-e",
  `import { resolveDevEnv } from "./scripts/dev-env.mjs";
const {env} = resolveDevEnv(); console.log(JSON.stringify(env));`,
];

test("resolveDevEnv uses generated defaults and retains legitimate shell overrides", async () => {
  const root = await fixture();
  const defaults = await run(root, resolveArgs);
  expect(defaults.code).toBe(0);
  expect(JSON.parse(defaults.stdout)).toMatchObject({
    DATABASE_OWNER_URL: urls.ownerUrl,
    DATABASE_URL: urls.runtimeUrl,
    REDIS_URL: urls.redisUrl,
  });
  const overrides = {
    DATABASE_OWNER_URL: "postgres://foreign-owner/db?option=value",
    DATABASE_URL: "postgres://foreign-runtime/db",
    REDIS_URL: "redis://foreign-cache:6379/4",
    APP_URL: "https://shell.example.invalid",
  };
  const overridden = await run(root, resolveArgs, overrides);
  expect(overridden.code).toBe(0);
  expect(JSON.parse(overridden.stdout)).toMatchObject(overrides);
  const blanks = await run(root, resolveArgs, {
    DATABASE_OWNER_URL: "",
    DATABASE_URL: "",
    REDIS_URL: "",
  });
  expect(JSON.parse(blanks.stdout)).toMatchObject({
    DATABASE_OWNER_URL: urls.ownerUrl,
    DATABASE_URL: urls.runtimeUrl,
    REDIS_URL: urls.redisUrl,
  });
});

const name = "nw_e2e_0123456789abcdef0123456789abcdef";
const scripts = [
  ["seed", ["scripts/seed.mjs"]],
  ["e2e", ["scripts/e2e-database.mjs", "prepare", name]],
];
const foreignTargets = [
  [
    "owner role",
    {
      DATABASE_OWNER_URL: urls.ownerUrl.replace(
        "nightwatch_owner:",
        "nightwatch:",
      ),
    },
  ],
  [
    "runtime role",
    {
      DATABASE_URL: urls.runtimeUrl.replace("nightwatch:", "nightwatch_owner:"),
    },
  ],
  [
    "owner credentials",
    { DATABASE_OWNER_URL: urls.ownerUrl.replace("owner%40pw", "foreign") },
  ],
  [
    "runtime credentials",
    { DATABASE_URL: urls.runtimeUrl.replace("runtime+pw", "foreign") },
  ],
  [
    "owner host",
    { DATABASE_OWNER_URL: urls.ownerUrl.replace("127.0.0.1", "localhost") },
  ],
  [
    "runtime host",
    { DATABASE_URL: urls.runtimeUrl.replace("127.0.0.1", "localhost") },
  ],
  [
    "owner port",
    { DATABASE_OWNER_URL: urls.ownerUrl.replace(":5457", ":5458") },
  ],
  ["runtime port", { DATABASE_URL: urls.runtimeUrl.replace(":5457", ":5458") }],
  ["owner query", { DATABASE_OWNER_URL: `${urls.ownerUrl}?database=foreign` }],
  ["runtime query", { DATABASE_URL: `${urls.runtimeUrl}?database=foreign` }],
];
for (const [label, args] of scripts) {
  test(`${label} accepts exact generated targets before the dependency boundary`, async () => {
    const result = await run(await fixture(), args);
    if (label === "seed") {
      expect(result.code).toBe(0);
      expect(result.calls).toEqual([
        [
          "readSeedConfig",
          urls.ownerUrl,
          urls.runtimeUrl,
          urls.ownerUrl,
          urls.runtimeUrl,
        ],
        ["seedLocalDemo", urls.ownerUrl, urls.runtimeUrl],
      ]);
    } else {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("DB_SENTINEL");
      expect(result.calls).toEqual([["createDatabase", urls.ownerUrl]]);
    }
  });
  test(`${label} preserves quoted whitespace-only generated passwords before the dependency boundary`, async () => {
    const result = await run(
      await fixture({ NW_OWNER_PASSWORD: " ", NW_DB_PASSWORD: "  " }),
      args,
    );
    const ownerUrl = "postgres://nightwatch_owner: @127.0.0.1:5457/nightwatch";
    const runtimeUrl = "postgres://nightwatch:  @127.0.0.1:5457/nightwatch";
    if (label === "seed") {
      expect(result.code).toBe(0);
      expect(result.calls).toEqual([
        ["readSeedConfig", ownerUrl, runtimeUrl, ownerUrl, runtimeUrl],
        ["seedLocalDemo", ownerUrl, runtimeUrl],
      ]);
    } else {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("DB_SENTINEL");
      expect(result.calls).toEqual([["createDatabase", ownerUrl]]);
    }
  });
  for (const [target, overrides] of foreignTargets) {
    test(`${label} refuses shell ${target} before connect/write`, async () => {
      const result = await run(await fixture(), args, overrides);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        label === "seed"
          ? "must exactly match"
          : "local Compose database and Redis URLs",
      );
      expect(result.calls).toEqual([]);
    });
  }
  for (const { key, value } of missingPasswords) {
    test(`${label} refuses generated ${key}=${JSON.stringify(value)} before connect/write`, async () => {
      const result = await run(
        await fixture({ ...secrets, [key]: value }),
        args,
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        label === "seed"
          ? "must exactly match"
          : "requires generated local Compose passwords",
      );
      expect(result.calls).toEqual([]);
    });
  }
  test(`${label} refuses an absent generated secrets file before connect/write`, async () => {
    const result = await run(await fixture(null), args);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("db:up");
    expect(result.calls).toEqual([]);
  });
}

for (const redisUrl of [
  "redis://foreign:6380",
  "redis://127.0.0.1:6381",
  "redis://127.0.0.1:6380?db=4",
]) {
  test(`e2e refuses shell Redis ${redisUrl} before connect/write`, async () => {
    const result = await run(await fixture(), scripts[1][1], {
      REDIS_URL: redisUrl,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("local Compose database and Redis URLs");
    expect(result.calls).toEqual([]);
  });
}

for (const args of [
  ["cleanup", "nightwatch"],
  ["cleanup", `${name}_extra`],
  ["drop", name],
]) {
  test(`e2e retains destructive namespace guard for ${args.join(" ")}`, async () => {
    const result = await run(await fixture(), [
      "scripts/e2e-database.mjs",
      ...args,
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Expected prepare|cleanup");
    expect(result.calls).toEqual([]);
  });
}
