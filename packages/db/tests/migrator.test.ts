import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listMigrations, sha256 } from "../src/migrator";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nightwatch-migrations-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listMigrations", () => {
  it("loads only NNNN_name.sql files in lexical order with content hashes", async () => {
    await writeFile(join(dir, "0002_add_widgets.sql"), "select 2;");
    await writeFile(join(dir, "0001_init.sql"), "select 1;");
    await writeFile(join(dir, "notes.md"), "not a migration");
    await writeFile(join(dir, "wrong_name.sql"), "select 0;");

    const migrations = await listMigrations(dir);
    expect(migrations.map((migration) => migration.name)).toEqual([
      "0001_init.sql",
      "0002_add_widgets.sql",
    ]);
    expect(migrations[0]?.sha256).toBe(sha256("select 1;"));
  });

  it("rejects nothing on an empty directory", async () => {
    expect(await listMigrations(dir)).toEqual([]);
  });
});

describe("sha256", () => {
  it("is stable and content-sensitive", () => {
    expect(sha256("a")).toBe(sha256("a"));
    expect(sha256("a")).not.toBe(sha256("b"));
    expect(sha256("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
