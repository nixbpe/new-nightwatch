import type { AuditLogListResponse } from "@nightwatch/api-contract";
import { readAuditEventBatch, withTenantUserContextRaw } from "@nightwatch/db";
import { auditActionCodesMatching } from "@nightwatch/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";
import { AUDIT_ACTION_CATEGORIES, type AuditAction } from "./record";

// The export reads events through readAuditEventBatch; the page through the
// list API. Both build their filter from packages/db, and this proves that for
// the same filters they select the same events in the same order.
let ctx: MonitorTestContext;
let org: TestOrganization;
let monitorId: string;
const ids: Record<string, string> = {};

async function seed(
  actor: string,
  action: AuditAction,
  targetType: string,
  targetId: string | null,
  at: string,
  attributes: object = {},
): Promise<string> {
  const rows = await ctx.owner.sql.query<{ id: string }>(
    `insert into audit_events
       (tenant_id, occurred_at, actor_user_id, actor_role, category, action,
        target_type, target_id, target_attributes)
     values ($1, now() - $2::interval, $3, 'admin', $4, $5, $6, $7, $8::jsonb)
     returning id`,
    [
      org.id,
      at,
      actor,
      AUDIT_ACTION_CATEGORIES[action],
      action,
      targetType,
      targetId,
      JSON.stringify(attributes),
    ],
  );
  return rows.rows[0]?.id ?? "";
}

async function viaList(query: URLSearchParams): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 50) {
    query.set("offset", String(offset));
    const response = await ctx.call(
      org.users.owner,
      "GET",
      `/api/organizations/${org.id}/audit-log/events?${query.toString()}`,
    );
    expect(response.status).toBe(200);
    const page = response.json as AuditLogListResponse;
    out.push(...page.events.map((event) => event.id));
    if (offset + 50 >= page.page.total) return out;
  }
}

async function viaExport(
  filter: {
    from?: string;
    to?: string;
    categories?: string[];
    actorUserId?: string;
    q?: string;
  },
  snapshotAt: Date,
): Promise<string[]> {
  const out: string[] = [];
  let cursor: { occurredAt: string; id: string } | null = null;
  do {
    const batch = await withTenantUserContextRaw(
      ctx.runtime,
      org.id,
      org.users.owner,
      (client) =>
        readAuditEventBatch(client, {
          tenantId: org.id,
          filter: {
            from: filter.from ?? "-infinity",
            to: filter.to ?? "infinity",
            categories: filter.categories ?? [],
            actorUserId: filter.actorUserId,
            q: filter.q,
          },
          actionCodes: filter.q ? auditActionCodesMatching(filter.q) : [],
          snapshotAt,
          cursor,
          limit: 7,
        }),
    );
    out.push(...batch.rows.map((row) => row.id));
    cursor = batch.next;
  } while (cursor);
  return out;
}

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  org = await ctx.createOrganization("auditparity");
  await ctx.owner.sql.query(
    "update organization set audit_recording_started_at = now() - interval '400 days' where id = $1",
    [org.id],
  );
  monitorId = crypto.randomUUID();
  await ctx.owner.sql.query(
    `insert into monitors (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
     values ($1, $2, 'Parity_100%_Checkout', 'https://x.example.test/', 60, 10, $3)`,
    [monitorId, org.id, crypto.randomUUID()],
  );
  const owner = org.users.owner;
  const admin = org.users.admin;
  for (let i = 0; i < 12; i += 1) {
    await seed(
      owner,
      "organization.member.leave",
      "member",
      owner,
      `${String(i + 1)} minutes`,
    );
  }
  ids.monitor = await seed(
    admin,
    "organization.monitor.pause",
    "monitor",
    monitorId,
    "2 days",
  );
  ids.deleted = await seed(
    admin,
    "organization.monitor.delete",
    "monitor",
    crypto.randomUUID(),
    "3 days",
  );
  ids.member = await seed(
    owner,
    "organization.member.role.update",
    "member",
    org.users.viewer,
    "4 days",
  );
  ids.invitation = await seed(
    owner,
    "organization.invitation.create",
    "invitation",
    "0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a11",
    "5 days",
    { role: "viewer" },
  );
  // Events older than the available partitions are covered by the window tests
  // of the read and export suites, which run in databases of their own.
  ids.old = await seed(
    owner,
    "organization.member.leave",
    "member",
    owner,
    "25 days",
  );
  ids.same1 = await seed(
    admin,
    "organization.notification-settings.update",
    "notification_settings",
    null,
    "6 days",
  );
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

describe("the export selects the events the list shows", () => {
  const cases: [
    string,
    () => {
      list: URLSearchParams;
      exportFilter: Parameters<typeof viaExport>[0];
    },
  ][] = [
    ["no filter", () => ({ list: new URLSearchParams(), exportFilter: {} })],
    [
      "categories",
      () => ({
        list: new URLSearchParams({ categories: "monitor,invitation" }),
        exportFilter: { categories: ["monitor", "invitation"] },
      }),
    ],
    [
      "actor",
      () => ({
        list: new URLSearchParams({ actorUserId: org.users.admin }),
        exportFilter: { actorUserId: org.users.admin },
      }),
    ],
    [
      "time range",
      () => {
        const from = new Date(Date.now() - 4.5 * 86_400_000).toISOString();
        const to = new Date(Date.now() - 1 * 86_400_000).toISOString();
        return {
          list: new URLSearchParams({ from, to }),
          exportFilter: { from, to },
        };
      },
    ],
    [
      "search by label",
      () => ({
        list: new URLSearchParams({ q: "หยุดมอนิเตอร์" }),
        exportFilter: { q: "หยุดมอนิเตอร์" },
      }),
    ],
    [
      "search by action code, mixed case",
      () => ({
        list: new URLSearchParams({ q: "Member.Role.Update" }),
        exportFilter: { q: "Member.Role.Update" },
      }),
    ],
    [
      "search by name with wildcard characters",
      () => ({
        list: new URLSearchParams({ q: "100%_check" }),
        exportFilter: { q: "100%_check" },
      }),
    ],
    [
      "search by actor name",
      () => ({
        list: new URLSearchParams({ q: "auditparity-admin" }),
        exportFilter: { q: "auditparity-admin" },
      }),
    ],
    [
      "search by invitation public id",
      () => ({
        list: new URLSearchParams({
          q: "0B6F9A52-3B7C-4F0D-9F5B-2D6F5E0D1A11",
        }),
        exportFilter: { q: "0B6F9A52-3B7C-4F0D-9F5B-2D6F5E0D1A11" },
      }),
    ],
    [
      "search by email finds nothing",
      () => ({
        list: new URLSearchParams({ q: "@example.test" }),
        exportFilter: { q: "@example.test" },
      }),
    ],
    [
      "everything together",
      () => {
        const from = new Date(Date.now() - 10 * 86_400_000).toISOString();
        return {
          list: new URLSearchParams({
            from,
            categories: "monitor,member",
            actorUserId: org.users.admin,
            q: "มอนิเตอร์",
          }),
          exportFilter: {
            from,
            categories: ["monitor", "member"],
            actorUserId: org.users.admin,
            q: "มอนิเตอร์",
          },
        };
      },
    ],
  ];

  it.each(cases)("%s", async (_name, build) => {
    const { list, exportFilter } = build();
    const snapshotAt = new Date(Date.now() + 1_000);
    list.set("asOf", snapshotAt.toISOString());
    const fromList = await viaList(list);
    const fromExport = await viaExport(exportFilter, snapshotAt);
    expect(fromExport).toEqual(fromList);
  });

  it("holds the cases above to a non-trivial result", async () => {
    const all = await viaExport({}, new Date(Date.now() + 1_000));
    // 12 + monitor, deleted, member, invitation, old, settings.
    expect(all).toHaveLength(18);
    expect(
      await viaExport({ q: "100%_check" }, new Date(Date.now() + 1_000)),
    ).toEqual([ids.monitor]);
  });
});
