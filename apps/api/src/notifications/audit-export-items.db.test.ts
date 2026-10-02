import { notificationListResponseSchema } from "@nightwatch/api-contract";
import {
  createDatabase,
  insertAuditExportNotificationIntent,
  runMigrations,
  withTenantUserContextRaw,
} from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { listInbox } from "./service";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const database = createDatabase(runtimeUrl);
const owner = new Client({ connectionString: ownerUrl });
const run = crypto.randomUUID().slice(0, 8);
const org = crypto.randomUUID();
const requester = crypto.randomUUID();
const colleague = crypto.randomUUID();
const leaver = crypto.randomUUID();
const requesterToken = `export-items-requester-${run}`;
const colleagueToken = `export-items-colleague-${run}`;
const readyExport = crypto.randomUUID();
const failedExport = crypto.randomUUID();
const deps = { database, cursorSecret: "export-items-secret" };
const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.connect();
  await owner.query(
    "insert into organization (id, name, slug) values ($1, $2, $3)",
    [org, `Export items ${run}`, `export-items-${run}`],
  );
  for (const [id, name, role, token] of [
    [requester, "requester", "viewer", requesterToken],
    [colleague, "colleague", "admin", colleagueToken],
    [leaver, "leaver", "admin", null],
  ] as const) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified, last_active_tenant_id)
       values ($1, $2, $3, true, $4)`,
      [id, name, `export-items-${name}-${run}@example.test`, org],
    );
    if (id !== leaver) {
      await owner.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [crypto.randomUUID(), org, id, role],
      );
    }
    if (token) {
      await owner.query(
        `insert into session (id, token, user_id, expires_at, active_organization_id)
         values ($1, $2, $3, now() + interval '1 day', $4)`,
        [crypto.randomUUID(), token, id, org],
      );
    }
  }
  for (const [exportId, outcome, user] of [
    [readyExport, "ready", requester],
    [failedExport, "failed", requester],
    [crypto.randomUUID(), "failed", leaver],
  ] as const) {
    await withTenantUserContextRaw(database, org, user, (client) =>
      insertAuditExportNotificationIntent(client, {
        tenantId: org,
        exportId,
        requesterUserId: user,
        outcome,
      }),
    );
  }
  // What the Worker's materialize step does for a completed dispatch.
  await owner.query(
    `insert into notification_inbox_items
       (id, intent_id, origin, recipient_user_id, scope_kind, tenant_id,
        event_type, occurred_at, subject_audit_export_id)
     select gen_random_uuid()::text, intent.id, intent.origin,
            recipient.recipient_user_id, 'tenant', intent.tenant_id,
            intent.event_type, intent.occurred_at, intent.subject_audit_export_id
     from notification_intents intent
     join notification_intent_recipients recipient on recipient.intent_id = intent.id
     where intent.tenant_id = $1`,
    [org],
  );
  await owner.query(
    "update notification_dispatch_ledger set status = 'completed' where tenant_id = $1",
    [org],
  );
}, 120_000);

afterAll(async () => {
  await owner.query('delete from "user" where id = any($1::text[])', [
    [requester, colleague, leaver],
  ]);
  await owner.query("delete from organization where id = $1", [org]);
  await owner.end();
  await database.close();
});

describe("audit export notifications in the inbox", () => {
  it("shows ready and failed to the requester only, in the audit-log category", async () => {
    const list = notificationListResponseSchema.parse(
      await listInbox(deps, {
        userId: requester,
        sessionToken: requesterToken,
        limit: 20,
      }),
    );
    expect(list.items.map((item) => item.eventType).sort()).toEqual([
      "AUDIT_EXPORT_FAILED",
      "AUDIT_EXPORT_READY",
    ]);
    for (const item of list.items) {
      expect(item).toMatchObject({
        scope: "organization",
        organizationId: org,
        category: "audit-log",
        actor: null,
      });
    }
    // The failure reaches a requester who is no longer an owner/admin (P-07).
    const colleagueList = await listInbox(deps, {
      userId: colleague,
      sessionToken: colleagueToken,
      limit: 20,
    });
    expect(colleagueList.items).toEqual([]);
  });

  it("raises nothing for a requester who has left the Organization", async () => {
    const rows = await owner.query(
      `select 1 from notification_intent_recipients where recipient_user_id = $1`,
      [leaver],
    );
    expect(rows.rowCount).toBe(0);
    const intents = await owner.query(
      "select 1 from notification_intents where tenant_id = $1",
      [org],
    );
    expect(intents.rowCount).toBe(2);
  });
});
