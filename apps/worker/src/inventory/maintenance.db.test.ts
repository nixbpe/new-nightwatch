import { randomUUID } from "node:crypto";

import type { Database } from "@nightwatch/db";
import { openTestPostgres } from "@nightwatch/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runInventoryMaintenance } from "./maintenance";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

let fixture: Awaited<ReturnType<typeof openTestPostgres>>;
let database: Database;
const tenant = randomUUID();
const project = randomUUID();
const users = [randomUUID(), randomUUID(), randomUUID()];

const ids = async () =>
  (
    await fixture.owner.sql.query<{ created_by: string }>(
      "select created_by from inventory_previews order by created_by",
    )
  ).rows.map((row) => row.created_by);

// The test moves the preview back in time, which is the same as the clock moving forward:
// the purge compares `expires_at` with the database's now().
const age = (userId: string, minutes: number) =>
  fixture.owner.sql.query(
    `update inventory_previews
     set created_at = created_at - make_interval(mins => $2),
         expires_at = expires_at - make_interval(mins => $2)
     where created_by = $1`,
    [userId, minutes],
  );

beforeAll(async () => {
  fixture = await openTestPostgres("inventory-preview-purge");
  database = fixture.runtime;
  const owner = fixture.owner.sql;
  await owner.query(
    "insert into organization (id, name, slug) values ($1, 'Previews', $2)",
    [tenant, `previews-${tenant}`],
  );
  for (const id of users) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified) values ($1, $1, $2, true)`,
      [id, `${id}@example.test`],
    );
    await owner.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'viewer', now(), now())`,
      [randomUUID(), tenant, id],
    );
  }
  await owner.query(
    "insert into projects (id, tenant_id, name, slug) values ($1, $2, 'Payments', 'payments')",
    [project, tenant],
  );
  for (const id of users) {
    await owner.query(
      `insert into inventory_previews (tenant_id, project_id, created_by, file_name, rows, summary, fingerprints)
       values ($1, $2, $3, 'inventory.csv', '[]', '{}', '{}')`,
      [tenant, project, id],
    );
  }
}, 120_000);

afterAll(async () => {
  await fixture.close();
});

describe("expired import previews", () => {
  it("are deleted with no page open, unexpired ones survive, and a second run changes nothing", async () => {
    const [soon, expired, justExpired] = users as [string, string, string];
    await age(soon, 29);
    await age(expired, 31);
    await age(justExpired, 30);
    expect(await ids()).toHaveLength(3);

    expect(await runInventoryMaintenance(database, logger)).toBe(2);
    expect(await ids()).toEqual([soon]);
    expect(await runInventoryMaintenance(database, logger)).toBe(0);
    expect(await ids()).toEqual([soon]);

    await age(soon, 2);
    expect(await runInventoryMaintenance(database, logger)).toBe(1);
    expect(await ids()).toEqual([]);
  });
});
