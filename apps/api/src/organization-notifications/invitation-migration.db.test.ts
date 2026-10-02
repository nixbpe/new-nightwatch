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
  it("backfills sent_at from created_at, gives each invitation its own public_id and defaults new rows", async () => {
    const sql = await readFile(
      `${migrationsDir}/0018_invitation_management.sql`,
      "utf8",
    );
    const client = await owner.sql.connect();
    try {
      // A temp table shadows public.invitation for unqualified names, so the
      // real 0018 file runs on a pre-0018 copy without locking the shared table.
      await client.query("begin");
      await client.query(
        `create temp table invitation (
           id text primary key, organization_id uuid not null, email text not null,
           role text not null, status text not null default 'pending',
           inviter_id text not null, expires_at timestamptz,
           created_at timestamptz not null default now(),
           updated_at timestamptz not null default now())`,
      );
      await client.query(
        `insert into invitation (id, organization_id, email, role, inviter_id, created_at)
         select 'legacy-' || n, gen_random_uuid(), 'r' || n || '@example.test', 'viewer', 'u',
                timestamptz '2026-01-01 00:00:00+00' + n * interval '1 day'
         from generate_series(1, 3) n`,
      );
      await client.query(sql);
      const backfilled = await client.query<{
        sentAtMatchesCreatedAt: boolean;
        distinctPublicIds: number;
        total: number;
      }>(
        `select bool_and(sent_at = created_at) as "sentAtMatchesCreatedAt",
                count(distinct public_id)::int as "distinctPublicIds",
                count(*)::int as total
         from invitation`,
      );
      expect(backfilled.rows[0]).toEqual({
        sentAtMatchesCreatedAt: true,
        distinctPublicIds: 3,
        total: 3,
      });

      await client.query(
        `insert into invitation (id, organization_id, email, role, inviter_id)
         values ('fresh', gen_random_uuid(), 'fresh@example.test', 'viewer', 'u')`,
      );
      const fresh = await client.query<{
        publicId: string | null;
        sentAt: Date | null;
      }>(
        `select public_id as "publicId", sent_at as "sentAt"
         from invitation where id = 'fresh'`,
      );
      expect(fresh.rows[0]?.publicId).toEqual(expect.any(String));
      expect(fresh.rows[0]?.sentAt).toBeInstanceOf(Date);

      await client.query("savepoint null_sent_at");
      await expect(
        client.query(
          `insert into invitation (id, organization_id, email, role, inviter_id, sent_at)
           values ('null-sent', gen_random_uuid(), 'n@example.test', 'viewer', 'u', null)`,
        ),
      ).rejects.toThrow(/sent_at/);
      await client.query("rollback to savepoint null_sent_at");

      await client.query("savepoint duplicate_public_id");
      await expect(
        client.query(
          `update invitation set public_id = (select public_id from invitation where id = 'legacy-1')
           where id = 'legacy-2'`,
        ),
      ).rejects.toThrow(/invitation_public_id_key/);
      await client.query("rollback to savepoint duplicate_public_id");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
