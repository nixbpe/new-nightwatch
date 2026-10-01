import { createDatabase, runMigrations } from "@nightwatch/db";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

const { ownerUrl } = requireIntegrationDatabaseUrls();
const owner = createDatabase(ownerUrl);
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
}, 120_000);

afterAll(async () => {
  await owner.close();
});

describe("migration 0018 invitation management", () => {
  it("backfills sent_at from created_at and gives every existing invitation its own public_id", async () => {
    const sql = await readFile(
      `${migrationsDir}/0018_invitation_management.sql`,
      "utf8",
    );
    const run = crypto.randomUUID();
    const client = await owner.sql.connect();
    try {
      // Rolled back below: the shared test database keeps its migrated shape.
      await client.query("begin");
      await client.query(
        "alter table invitation drop column public_id, drop column sent_at",
      );
      await client.query(
        "insert into organization (id, name, slug) values ($1, 'Legacy', $2)",
        [run, `legacy-${run}`],
      );
      await client.query(
        `insert into "user" (id, name, email, email_verified, created_at, updated_at)
         values ($1, 'inviter', $2, true, now(), now())`,
        [run, `legacy-${run}@example.test`],
      );
      await client.query(
        `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
         select 'legacy-' || n || '-${run}', $1, 'r' || n || '@example.test', 'viewer',
                'pending', $2, null, timestamptz '2026-01-01 00:00:00+00' + n * interval '1 day'
         from generate_series(1, 3) n`,
        [run, run],
      );
      await client.query(sql);
      const result = await client.query<{
        sentAtMatchesCreatedAt: boolean;
        distinctPublicIds: number;
        total: number;
      }>(
        `select bool_and(sent_at = created_at) as "sentAtMatchesCreatedAt",
                count(distinct public_id)::int as "distinctPublicIds",
                count(*)::int as total
         from invitation where organization_id = $1`,
        [run],
      );
      expect(result.rows[0]).toEqual({
        sentAtMatchesCreatedAt: true,
        distinctPublicIds: 3,
        total: 3,
      });
      const duplicate = await client
        .query("savepoint dup")
        .then(() =>
          client.query(
            `update invitation set public_id = (
               select public_id from invitation where organization_id = $1 limit 1
             ) where organization_id = $1`,
            [run],
          ),
        )
        .then(
          () => "accepted",
          () => "rejected",
        );
      expect(duplicate).toBe("rejected");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
