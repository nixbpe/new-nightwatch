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
const directory = mkdtempSync(join(tmpdir(), "nw-postgres-adapter-"));
writeFileSync(
  join(directory, "docker"),
  '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\n',
);
chmodSync(join(directory, "docker"), 0o700);
afterEach(() => {
  process.env.PATH = originalPath;
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
  delete process.env.TEST_POSTGRES_CONTAINER;
  process.env.PATH = `${directory}:${originalPath}`;
  writeFileSync(
    join(directory, "adapter.mjs"),
    readFileSync(new URL("../test-postgres-command.mjs", import.meta.url)),
  );
  writeFileSync(
    join(directory, "dev-env.mjs"),
    `export const LOCAL_ENV_PATH = "unused";
export const resolveDevEnv = () => ({hasLocalEnv:true, ports:{slot:37}});
export const buildLocalComposeUrls = () => ({ownerUrl:"postgres://owned/database"});`,
  );
  writeFileSync(
    join(directory, "env-file.mjs"),
    "export const readEnvFile = () => ({});",
  );
  writeFileSync(
    join(directory, "ports.mjs"),
    'export const repoRoot = "/owning/worktree";',
  );
  const local = await import(join(directory, "adapter.mjs"));
  const output = await local.testPostgresCommand("postgres://owned/database")([
    "pg_dump",
  ]);
  expect(output).toContain("-p\nnw-dev-37\nexec\n-T\npostgres\npg_dump\n");
  expect(() => local.testPostgresCommand("postgres://wrong/database")).toThrow(
    "owning worktree",
  );
});
