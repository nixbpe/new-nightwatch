import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testPostgresCommand } from "../test-postgres-command.mjs";

const originalContainer = process.env.TEST_POSTGRES_CONTAINER;
const originalPath = process.env.PATH;
const composeKeys = [
  ...new Set(
    [
      ...readFileSync(
        new URL("../../compose.yaml", import.meta.url),
        "utf8",
      ).matchAll(/\$\{(NW_\w+):\?/g),
    ].map((match) => match[1]),
  ),
];
const originalComposeEnv = Object.fromEntries(
  composeKeys.map((key) => [key, process.env[key]]),
);
const directory = mkdtempSync(join(tmpdir(), "nw-postgres-adapter-"));
writeFileSync(
  join(directory, "docker"),
  `#!/usr/bin/env bun
if (process.argv[2] === "compose") {
  const keys = ${JSON.stringify(composeKeys)};
  if (keys.some(key => !process.env[key])) process.exit(71);
  console.log("ports=" + ["NW_SLOT", "NW_DB_PORT", "NW_REDIS_PORT", "NW_MAIL_SMTP_PORT", "NW_MAIL_UI_PORT"].map(key => process.env[key]).join(","));
  if (process.env.NW_OWNER_PASSWORD !== "owner-secret" || process.env.NW_DB_PASSWORD !== "runtime-secret") process.exit(72);
}
console.log(process.argv.slice(2).join("\\n"));
process.stdout.write(await Bun.stdin.text());
`,
);
chmodSync(join(directory, "docker"), 0o700);
afterEach(() => {
  process.env.PATH = originalPath;
  for (const [key, value] of Object.entries(originalComposeEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalContainer === undefined)
    delete process.env.TEST_POSTGRES_CONTAINER;
  else process.env.TEST_POSTGRES_CONTAINER = originalContainer;
});
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));

test("CI uses only the explicitly bound service container and streams schema via stdin", async () => {
  process.env.TEST_POSTGRES_CONTAINER = "a".repeat(64);
  process.env.PATH = `${directory}:${originalPath}`;
  const output = await testPostgresCommand("unused")(
    ["psql", "-d", "owned"],
    "schema",
  );
  expect(output).toBe(`exec\n-i\n${"a".repeat(64)}\npsql\n-d\nowned\nschema`);
});
test("invalid CI bindings cannot fall back to another database", () => {
  process.env.TEST_POSTGRES_CONTAINER = "unrelated";
  expect(() => testPostgresCommand("unused")).toThrow("Invalid CI");
});
test("local runner selects only the owning Compose postgres service", async () => {
  for (const key of composeKeys) delete process.env[key];
  delete process.env.TEST_POSTGRES_CONTAINER;
  process.env.PATH = `${directory}:${originalPath}`;
  writeFileSync(
    join(directory, "adapter.mjs"),
    readFileSync(new URL("../test-postgres-command.mjs", import.meta.url)),
  );
  writeFileSync(
    join(directory, "dev-env.mjs"),
    `export const LOCAL_ENV_PATH = "unused";
export const resolveDevEnv = () => ({env:process.env,hasLocalEnv:true, ports:{slot:37,dbPort:5437,mailSmtpPort:7437,mailUiPort:7537},redisPort:6417});
export const buildLocalComposeUrls = () => ({ownerUrl:"postgres://owned/database"});`,
  );
  writeFileSync(
    join(directory, "env-file.mjs"),
    'export const readEnvFile = () => ({NW_OWNER_PASSWORD:"owner-secret",NW_DB_PASSWORD:"runtime-secret"});',
  );
  writeFileSync(
    join(directory, "ports.mjs"),
    'export const repoRoot = "/owning/worktree";',
  );
  const local = await import(join(directory, "adapter.mjs"));
  const output = await local.testPostgresCommand("postgres://owned/database")([
    "pg_dump",
  ]);
  expect(output).toContain("ports=37,5437,6417,7437,7537");
  expect(output).toContain("-p\nnw-dev-37\nexec\n-T\npostgres\npg_dump\n");
  expect(() => local.testPostgresCommand("postgres://wrong/database")).toThrow(
    "owning worktree",
  );
});
