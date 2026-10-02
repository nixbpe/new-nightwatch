import type {
  AuditExportCreateResponse,
  AuditExportListResponse,
} from "@nightwatch/api-contract";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  openMonitorTestContext,
  type ApiResponse,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";

let ctx: MonitorTestContext;
let orgA: TestOrganization;
let orgB: TestOrganization;
let bothOwner: string;
const { ownerUrl } = requireIntegrationDatabaseUrls();

const base = (organizationId: string) =>
  `/api/organizations/${organizationId}/audit-log`;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const body = (overrides: Record<string, unknown> = {}) => ({
  format: "csv",
  timeZone: "Asia/Bangkok",
  filters: { from: iso(-3_600_000 * 24 * 30), to: iso(3_600_000) },
  asOf: iso(),
  ...overrides,
});
const requestExport = (
  userId: string | null,
  organizationId: string,
  payload: unknown = body(),
) => ctx.call(userId, "POST", `${base(organizationId)}/exports`, payload);
const listExports = (userId: string | null, organizationId: string) =>
  ctx.call(userId, "GET", `${base(organizationId)}/exports`);
const download = (userId: string | null, organizationId: string, id: string) =>
  ctx.call(userId, "GET", `${base(organizationId)}/exports/${id}/download`);

async function organization(label: string): Promise<TestOrganization> {
  const created = await ctx.createOrganization(label);
  await ctx.owner.sql.query(
    "update organization set audit_recording_started_at = now() - interval '400 days' where id = $1",
    [created.id],
  );
  return created;
}

async function seedEvents(organizationId: string, actorUserId: string, n = 3) {
  await ctx.owner.sql.query(
    `insert into audit_events
       (tenant_id, occurred_at, actor_user_id, actor_role, category, action,
        target_type, target_id)
     select $1, now() - make_interval(secs => g), $2, 'owner', 'member',
            'organization.member.leave', 'member', $2
     from generate_series(1, $3) g`,
    [organizationId, actorUserId, n],
  );
}

const counts = async (organizationId: string) => {
  const result = await ctx.owner.sql.query<{
    exports: number;
    jobs: number;
    events: number;
  }>(
    `select (select count(*)::int from audit_exports where tenant_id = $1) as exports,
            (select count(*)::int from audit_export_jobs where tenant_id = $1) as jobs,
            (select count(*)::int from audit_events where tenant_id = $1
              and action = 'organization.audit-log.export') as events`,
    [organizationId],
  );
  return result.rows[0];
};

const asCreate = (r: ApiResponse) => r.json as AuditExportCreateResponse;
const asList = (r: ApiResponse) => r.json as AuditExportListResponse;

/** An export of the user in the given state, written as the owner role. */
async function seedExport(
  organizationId: string,
  userId: string,
  state: "queued" | "running" | "ready" | "failed",
  options: {
    age?: string;
    fileExpiresIn?: string;
    content?: string;
    format?: "csv" | "json";
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.owner.sql.query(
    `insert into audit_exports
       (id, tenant_id, requested_by, format, filters, time_zone, snapshot_at,
        created_at, content, file_expires_at, row_count, completed_at, failure_code)
     values ($1, $2, $3, $4, $5::jsonb, 'UTC', '2026-10-03T10:20:30Z',
             now() - $6::interval, $7, now() + $8::interval,
             case when $9::text = 'ready' then 3 end,
             case when $9::text in ('ready', 'failed') then now() end,
             case when $9::text = 'failed' then 'EXPORT_FAILED' end)`,
    [
      id,
      organizationId,
      userId,
      options.format ?? "csv",
      JSON.stringify({
        from: iso(-86_400_000),
        to: iso(),
        categories: [],
        actorUserId: null,
        q: null,
      }),
      options.age ?? "1 minute",
      state === "ready" ? Buffer.from(options.content ?? "file") : null,
      options.fileExpiresIn ?? "24 hours",
      state,
    ],
  );
  await ctx.owner.sql.query(
    `insert into audit_export_jobs
       (export_id, tenant_id, requested_by, state, created_at)
     select id, tenant_id, requested_by, $2::text, created_at
     from audit_exports where id = $1`,
    [id, state],
  );
  return id;
}

beforeAll(async () => {
  ctx = await openMonitorTestContext();
  orgA = await organization("auditexp-a");
  orgB = await organization("auditexp-b");
  bothOwner = await ctx.createUser("auditexp-both");
  for (const org of [orgA, orgB]) {
    await ctx.owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'admin', now(), now())`,
      [crypto.randomUUID(), org.id, bothOwner],
    );
    await seedEvents(org.id, org.users.owner);
  }
}, 120_000);

afterAll(async () => {
  await ctx.close();
});

describe("POST exports", () => {
  it("queues a CSV and a JSON request for owner and admin, with an event that holds the scope but not the search text", async () => {
    const org = await organization("auditexp-post");
    await seedEvents(org.id, org.users.owner);
    const q = `needle-${crypto.randomUUID()}`;
    const first = await requestExport(
      org.users.owner,
      org.id,
      body({
        filters: {
          from: iso(-86_400_000),
          to: iso(60_000),
          categories: ["member"],
          actorUserId: org.users.owner,
          q: "member",
        },
      }),
    );
    expect(first.status).toBe(201);
    const record = asCreate(first).export;
    expect(record).toMatchObject({
      format: "csv",
      status: "generating",
      timeZone: "Asia/Bangkok",
      completedAt: null,
      expiresAt: null,
      rowCount: null,
      failureCode: null,
      filters: {
        categories: ["member"],
        actorUserId: org.users.owner,
        q: "member",
      },
    });
    // The admin (a second user) exports JSON in the same Organization.
    const second = await requestExport(
      org.users.admin,
      org.id,
      body({ format: "json", filters: { ...body().filters, q } }),
    );
    expect(second.status).toBe(422);
    expect(second.json).toMatchObject({
      error: { code: "AUDIT_EXPORT_EMPTY" },
    });
    const adminJson = await requestExport(
      org.users.admin,
      org.id,
      body({ format: "json" }),
    );
    expect(adminJson.status).toBe(201);
    expect(asCreate(adminJson).export.format).toBe("json");

    const events = await ctx.owner.sql.query<{
      actor_user_id: string;
      actor_role: string;
      target_id: string;
      target_attributes: Record<string, unknown>;
      changes: unknown[];
      request_id: string | null;
    }>(
      `select actor_user_id, actor_role, target_id, target_attributes, changes, request_id
       from audit_events where tenant_id = $1 and action = 'organization.audit-log.export'
       order by occurred_at`,
      [org.id],
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0]).toMatchObject({
      actor_user_id: org.users.owner,
      actor_role: "owner",
      target_id: record.id,
      changes: [],
      target_attributes: {
        format: "csv",
        categories: ["member"],
        actorUserId: org.users.owner,
        searchApplied: true,
      },
    });
    expect(events.rows[0]?.request_id).toBe(first.headers.get("x-request-id"));
    expect(JSON.stringify(events.rows)).not.toContain("needle");
    expect(JSON.stringify(events.rows[0]?.target_attributes)).not.toContain(
      '"q"',
    );
  });

  it("answers auditor, viewer and non-member 403 with no count, whether the filter holds 0 or more than 50,000 events", async () => {
    const empty = await organization("auditexp-b01-empty");
    const huge = await organization("auditexp-b01-huge");
    await ctx.owner.sql.query(
      `insert into audit_events
         (tenant_id, occurred_at, actor_user_id, actor_role, category, action,
          target_type, target_id)
       select $1, now() - make_interval(secs => g), $2, 'owner', 'member',
              'organization.member.leave', 'member', $2
       from generate_series(1, 50001) g`,
      [huge.id, huge.users.owner],
    );
    const stranger = await ctx.createUser("auditexp-stranger");
    for (const org of [empty, huge]) {
      for (const [who, code] of [
        [org.users.auditor, "PERMISSION_DENIED"],
        [org.users.viewer, "PERMISSION_DENIED"],
        [stranger, "MEMBERSHIP_DENIED"],
      ] as const) {
        const response = await requestExport(who, org.id);
        expect(response.status).toBe(403);
        expect(response.json).toMatchObject({ error: { code } });
        expect(JSON.stringify(response.json)).not.toMatch(
          /"details"|50001|total/,
        );
      }
      expect(await counts(org.id)).toEqual({ exports: 0, jobs: 0, events: 0 });
    }
    expect((await requestExport(null, empty.id)).status).toBe(401);
    // Owner and admin do get the sizes.
    expect(
      (await requestExport(empty.users.owner, empty.id)).json,
    ).toMatchObject({ error: { code: "AUDIT_EXPORT_EMPTY" } });
    const tooLarge = await requestExport(huge.users.admin, huge.id);
    expect(tooLarge.status).toBe(422);
    expect(tooLarge.json).toMatchObject({
      error: {
        code: "AUDIT_EXPORT_TOO_LARGE",
        details: { limit: 50000, total: 50001 },
      },
    });
    expect(await counts(huge.id)).toEqual({ exports: 0, jobs: 0, events: 0 });
    expect(await counts(empty.id)).toEqual({ exports: 0, jobs: 0, events: 0 });
  }, 120_000);

  it("rejects malformed bodies with 400 and creates nothing", async () => {
    const before = await counts(orgA.id);
    for (const payload of [
      body({ format: "xml" }),
      body({ timeZone: "Mars/Olympus" }),
      body({ filters: { from: iso(), to: iso(-60_000) } }),
      body({ filters: { from: "yesterday", to: iso() } }),
      body({ asOf: "now" }),
      { format: "csv" },
    ]) {
      const response = await requestExport(orgA.users.owner, orgA.id, payload);
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(await counts(orgA.id)).toEqual(before);
  });

  it("allows one request in flight per user per Organization, and none race past it", async () => {
    const org = await organization("auditexp-one");
    await seedEvents(org.id, org.users.owner);
    const responses = await Promise.all([
      requestExport(org.users.owner, org.id),
      requestExport(org.users.owner, org.id),
      requestExport(org.users.owner, org.id),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(response.json).toMatchObject({
        error: { code: "AUDIT_EXPORT_IN_PROGRESS" },
      });
    }
    expect(await counts(org.id)).toEqual({ exports: 1, jobs: 1, events: 1 });
    // The same user in another Organization is not blocked (OD-20).
    expect((await requestExport(bothOwner, orgA.id)).status).toBe(201);
    expect((await requestExport(bothOwner, orgB.id)).status).toBe(201);
    // Another user of the same Organization is not blocked either.
    expect((await requestExport(org.users.admin, org.id)).status).toBe(201);
  });

  it("clamps a from older than the recording window and still exports what is inside", async () => {
    const org = await organization("auditexp-clamp");
    await seedEvents(org.id, org.users.owner);
    const response = await requestExport(
      org.users.owner,
      org.id,
      body({ filters: { from: "2000-01-01T00:00:00Z", to: iso(60_000) } }),
    );
    expect(response.status).toBe(201);
    expect(asCreate(response).export.filters.from).toBe("2000-01-01T00:00:00Z");
  });

  it("a demotion that commits first wins: 403, no request, no event; one that commits after the request leaves a download denied", async () => {
    const org = await organization("auditexp-demote");
    await seedEvents(org.id, org.users.owner);
    const holder = new Client({ connectionString: ownerUrl });
    await holder.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for update",
        [org.id],
      );
      const pending = requestExport(org.users.admin, org.id);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await holder.query(
        "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
        [org.id, org.users.admin],
      );
      await holder.query("commit");
      const response = await pending;
      expect(response.status).toBe(403);
      expect(response.json).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
      expect(await counts(org.id)).toEqual({ exports: 0, jobs: 0, events: 0 });
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }

    const second = await requestExport(org.users.owner, org.id);
    expect(second.status).toBe(201);
    const id = asCreate(second).export.id;
    await ctx.owner.sql.query(
      `update audit_exports set content = 'x', file_expires_at = now() + interval '1 hour',
              completed_at = now() where id = $1`,
      [id],
    );
    await ctx.owner.sql.query(
      "update audit_export_jobs set state = 'ready' where export_id = $1",
      [id],
    );
    expect((await download(org.users.owner, org.id, id)).status).toBe(200);
    await ctx.owner.sql.query(
      "update member set role = 'auditor' where organization_id = $1 and user_id = $2",
      [org.id, org.users.owner],
    );
    const denied = await download(org.users.owner, org.id, id);
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });
});

describe("GET exports", () => {
  it("lists only the caller's requests of the last 7 days, newest first, at most 20", async () => {
    const org = await organization("auditexp-list");
    const mine: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      mine.push(
        await seedExport(org.id, org.users.owner, "failed", {
          age: `${String(i + 1)} hours`,
        }),
      );
    }
    await seedExport(org.id, org.users.owner, "failed", { age: "8 days" });
    await seedExport(org.id, org.users.admin, "ready");
    const response = await listExports(org.users.owner, org.id);
    expect(response.status).toBe(200);
    const body = asList(response);
    expect(body.exports.map((item) => item.id)).toEqual(mine.slice(0, 20));
    expect(body.inProgress).toBe(false);
    expect(body.exports[0]).toMatchObject({
      status: "failed",
      failureCode: "EXPORT_FAILED",
    });
    const adminSees = asList(await listExports(org.users.admin, org.id));
    expect(adminSees.exports).toHaveLength(1);
    expect(adminSees.exports[0]?.status).toBe("ready");
  });

  it("derives generating, ready and expired from the ledger and the file expiry", async () => {
    const org = await organization("auditexp-status");
    const running = await seedExport(org.id, org.users.admin, "running");
    const ready = await seedExport(org.id, org.users.owner, "ready");
    const expired = await seedExport(org.id, org.users.owner, "ready", {
      age: "3 hours",
      fileExpiresIn: "-1 minute",
    });
    const owner = asList(await listExports(org.users.owner, org.id));
    expect(
      Object.fromEntries(owner.exports.map((item) => [item.id, item.status])),
    ).toEqual({ [ready]: "ready", [expired]: "expired" });
    const admin = asList(await listExports(org.users.admin, org.id));
    expect(admin).toMatchObject({
      inProgress: true,
      exports: [{ id: running, status: "generating" }],
    });
  });

  it("auditor, viewer and non-member are denied and a late request of theirs is left untouched", async () => {
    const org = await organization("auditexp-late-denied");
    const stranger = await ctx.createUser("auditexp-late-stranger");
    const late = await seedExport(org.id, org.users.auditor, "queued", {
      age: "61 minutes",
    });
    const intentsBefore = (
      await ctx.owner.sql.query<{ n: number }>(
        "select count(*)::int as n from notification_intents where tenant_id = $1",
        [org.id],
      )
    ).rows[0]?.n;
    for (const [who, code] of [
      [org.users.auditor, "PERMISSION_DENIED"],
      [org.users.viewer, "PERMISSION_DENIED"],
      [stranger, "MEMBERSHIP_DENIED"],
    ] as const) {
      const response = await listExports(who, org.id);
      expect(response.status).toBe(403);
      expect(response.json).toMatchObject({ error: { code } });
    }
    const state = await ctx.owner.sql.query<{ state: string }>(
      "select state from audit_export_jobs where export_id = $1",
      [late],
    );
    expect(state.rows[0]?.state).toBe("queued");
    expect(
      (
        await ctx.owner.sql.query<{ n: number }>(
          "select count(*)::int as n from notification_intents where tenant_id = $1",
          [org.id],
        )
      ).rows[0]?.n,
    ).toBe(intentsBefore);
  });

  it("fails a request that outlived 60 minutes with one notification, when its owner lists and when a new request is made", async () => {
    const org = await organization("auditexp-stale");
    await seedEvents(org.id, org.users.owner);
    const viaList = await seedExport(org.id, org.users.owner, "queued", {
      age: "61 minutes",
    });
    const listed = asList(await listExports(org.users.owner, org.id));
    expect(listed.inProgress).toBe(false);
    expect(listed.exports[0]).toMatchObject({
      id: viaList,
      status: "failed",
      failureCode: "EXPORT_FAILED",
    });
    // A second listing finds it already failed and adds nothing.
    await listExports(org.users.owner, org.id);

    const viaPost = await seedExport(org.id, org.users.admin, "running", {
      age: "2 hours",
    });
    const created = await requestExport(org.users.admin, org.id);
    expect(created.status).toBe(201);
    const intents = await ctx.owner.sql.query<{
      origin: string;
      event_type: string;
    }>(
      `select origin, event_type from notification_intents
       where tenant_id = $1 order by origin`,
      [org.id],
    );
    expect(intents.rows).toEqual(
      [
        {
          origin: `audit-export:${viaList}:failed`,
          event_type: "AUDIT_EXPORT_FAILED",
        },
        {
          origin: `audit-export:${viaPost}:failed`,
          event_type: "AUDIT_EXPORT_FAILED",
        },
      ].sort((a, b) => a.origin.localeCompare(b.origin)),
    );
    const failed = await ctx.owner.sql.query<{ state: string }>(
      "select state from audit_export_jobs where export_id = $1",
      [viaPost],
    );
    expect(failed.rows[0]?.state).toBe("failed");
  });
});

describe("GET download (AC-23)", () => {
  it("serves the requester's own ready file with the headers of the spec, and writes no event", async () => {
    const org = await organization("auditexp-dl");
    const csv = await seedExport(org.id, org.users.owner, "ready", {
      content: "a,b\n1,2\n",
    });
    const json = await seedExport(org.id, org.users.admin, "ready", {
      format: "json",
      content: '{"events":[]}',
    });
    const eventsBefore = (await counts(org.id))?.events;
    const response = await ctx.call(
      org.users.owner,
      "GET",
      `${base(org.id)}/exports/${csv}/download`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="nightwatch-audit-log-20261003T102030Z.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const jsonResponse = await download(org.users.admin, org.id, json);
    expect(jsonResponse.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(jsonResponse.headers.get("content-disposition")).toContain(".json");
    expect((await counts(org.id))?.events).toBe(eventsBefore);
  });

  it("denies everyone but the requester, in every state the spec names", async () => {
    const org = await organization("auditexp-dl-deny");
    const stranger = await ctx.createUser("auditexp-dl-stranger");
    const ready = await seedExport(org.id, org.users.owner, "ready");
    const queued = await seedExport(org.id, org.users.admin, "queued");
    const failed = await seedExport(org.id, org.users.admin, "failed", {
      age: "2 hours",
    });
    const expired = await seedExport(org.id, org.users.owner, "ready", {
      age: "30 hours",
      fileExpiresIn: "-1 minute",
    });
    const other = await seedExport(orgB.id, orgB.users.owner, "ready");
    const status = async (who: string | null, org_: string, id: string) => {
      const response = await download(who, org_, id);
      return [
        response.status,
        (response.json as { error?: { code?: string } } | null)?.error?.code,
      ];
    };
    expect(await status(org.users.owner, org.id, ready)).toEqual([
      200,
      undefined,
    ]);
    // Another member of the same Organization, even owner-equivalent: the same 404 as a missing id.
    expect(await status(org.users.admin, org.id, ready)).toEqual([
      404,
      "AUDIT_EXPORT_NOT_FOUND",
    ]);
    expect(await status(org.users.owner, org.id, crypto.randomUUID())).toEqual([
      404,
      "AUDIT_EXPORT_NOT_FOUND",
    ]);
    expect(await status(org.users.owner, org.id, "not-a-uuid")).toEqual([
      404,
      "AUDIT_EXPORT_NOT_FOUND",
    ]);
    // Another Organization's export through this Organization's URL.
    expect(await status(org.users.owner, org.id, other)).toEqual([
      404,
      "AUDIT_EXPORT_NOT_FOUND",
    ]);
    expect(await status(orgB.users.owner, org.id, other)).toEqual([
      403,
      "MEMBERSHIP_DENIED",
    ]);
    expect(await status(org.users.auditor, org.id, ready)).toEqual([
      403,
      "PERMISSION_DENIED",
    ]);
    expect(await status(org.users.viewer, org.id, ready)).toEqual([
      403,
      "PERMISSION_DENIED",
    ]);
    expect(await status(stranger, org.id, ready)).toEqual([
      403,
      "MEMBERSHIP_DENIED",
    ]);
    expect(await status(org.users.admin, org.id, queued)).toEqual([
      409,
      "AUDIT_EXPORT_NOT_READY",
    ]);
    expect(await status(org.users.admin, org.id, failed)).toEqual([
      409,
      "AUDIT_EXPORT_NOT_READY",
    ]);
    expect(await status(org.users.owner, org.id, expired)).toEqual([
      410,
      "AUDIT_EXPORT_EXPIRED",
    ]);
    // A removed member is denied as a non-member.
    await ctx.owner.sql.query(
      "delete from member where organization_id = $1 and user_id = $2",
      [org.id, org.users.owner],
    );
    expect(await status(org.users.owner, org.id, ready)).toEqual([
      403,
      "MEMBERSHIP_DENIED",
    ]);
  });

  it("treats a stored composite role by its normalized value", async () => {
    const org = await organization("auditexp-composite");
    const id = await seedExport(org.id, org.users.owner, "ready");
    await ctx.owner.sql.query(
      "update member set role = 'viewer,auditor' where organization_id = $1 and user_id = $2",
      [org.id, org.users.owner],
    );
    expect((await download(org.users.owner, org.id, id)).status).toBe(403);
    expect((await listExports(org.users.owner, org.id)).status).toBe(403);
    expect((await requestExport(org.users.owner, org.id)).status).toBe(403);
    await ctx.owner.sql.query(
      "update member set role = 'viewer,admin' where organization_id = $1 and user_id = $2",
      [org.id, org.users.owner],
    );
    expect((await download(org.users.owner, org.id, id)).status).toBe(200);
  });
});

describe("logs (AC-26)", () => {
  it("logs export route templates, never the search text, and denials with action and code only", async () => {
    const org = await organization("auditexp-log");
    await seedEvents(org.id, org.users.owner);
    const marker = `needle-${crypto.randomUUID()}`;
    await requestExport(
      org.users.auditor,
      org.id,
      body({ filters: { ...body().filters, q: marker } }),
    );
    await requestExport(
      org.users.owner,
      org.id,
      body({ filters: { ...body().filters, q: marker } }),
    );
    await listExports(org.users.owner, org.id);
    await download(org.users.owner, org.id, crypto.randomUUID());
    const text = ctx.lines.join("\n");
    expect(text).not.toContain(marker);
    expect(text).not.toContain(org.id);
    const paths = ctx
      .logRecords()
      .filter((line) => line.msg === "request completed")
      .map((line) => String(line.path));
    expect(paths).toContain(
      "/api/organizations/:organizationId/audit-log/exports",
    );
    expect(paths).toContain(
      "/api/organizations/:organizationId/audit-log/exports/:exportId/download",
    );
    const denial = ctx
      .logRecords()
      .find(
        (line) =>
          line.msg === "organization access denied" &&
          line.action === "organization.audit-log.export",
      );
    expect(denial).toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
