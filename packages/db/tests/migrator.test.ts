import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listMigrations } from "../src/migrator";

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
    expect(migrations).toEqual([
      {
        name: "0001_init.sql",
        sql: "select 1;",
        sha256:
          "354b7196c9ba5fb4b21cf615bb6ec4cd5c07503c34229feef033fc081a8c03f4",
      },
      {
        name: "0002_add_widgets.sql",
        sql: "select 2;",
        sha256:
          "b1bd6d0bfa373a448021e0b2e8311b967e0e7ff45431b7105668662498cc2067",
      },
    ]);
  });
});
