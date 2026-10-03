import { randomUUID } from "node:crypto";

import {
  claimAuditExport,
  claimNotificationDispatches,
  markNotificationDispatchEnqueued,
  failStaleAuditExports,
  withTenantUserContextRaw,
  type Database,
} from "@nightwatch/db";
import { createLogger, type AuditChange } from "@nightwatch/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotificationDispatchScheduler, type DispatchQueue } from "../dispatch";
import {
  createMaterializationDependencies,
  processMaterialization,
} from "../materialize";
import { AuditExporter, type ExporterOptions } from "./exporter";
import { runAuditMaintenance } from "./maintenance";
import { ensureAuditPartitionFor, openIsolatedDatabase } from "./test-support";

let runtime: Database;
let owner: Database;
let close: () => Promise<void>;
const lines: string[] = [];
const logger = createLogger(
  { level: "info", name: "audit-exporter-test" },
  { write: (line: string) => void lines.push(line) },
);
const run = randomUUID().slice(0, 8);
const org = randomUUID();
const otherOrg = randomUUID();
const requester = `req-${run}`;
const colleague = `col-${run}`;
const outsider = `out-${run}`;
const DAY = 24 * 3_600_000;
const MONITOR_NAME = `=HYPERLINK("http://evil.example","${run}")`;
const SECRET_VALUE = `secret-value-${run}`;

const exporter = (options: ExporterOptions = {}) =>
  new AuditExporter(runtime, logger, options);

async function sql<T extends object = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await owner.sql.query<T>(text, values)).rows;
}

async function addUser(id: string, name: string, role?: string, tenant = org) {
  await sql(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${id}@example.test`],
  );
  if (role) {
    await sql(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [randomUUID(), tenant, id, role],
    );
  }
}

type Seed = {
  tenant?: string;
  actor?: string;
  actorRole?: string;
  action?: string;
  category?: string;
  targetType?: string;
  targetId?: string | null;
  attributes?: Record<string, unknown>;
  changes?: AuditChange[];
  at?: string;
};
async function seedEvent(seed: Seed = {}): Promise<string> {
  const rows = await sql<{ id: string }>(
    `insert into audit_events
       (tenant_id, occurred_at, actor_user_id, actor_role, category, action,
        target_type, target_id, target_attributes, changes)
     values ($1, ${seed.at ?? "clock_timestamp()"}, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     returning id`,
    [
      seed.tenant ?? org,
      seed.actor ?? requester,
      seed.actorRole ?? "admin",
      seed.category ?? "member",
      seed.action ?? "organization.member.leave",
      seed.targetType ?? "member",
      seed.targetId === undefined ? (seed.actor ?? requester) : seed.targetId,
      JSON.stringify(seed.attributes ?? {}),
      JSON.stringify(seed.changes ?? []),
    ],
  );
  return rows[0]?.id ?? "";
}

type RequestOptions = {
  user?: string;
  tenant?: string;
  format?: "csv" | "json";
  filters?: Record<string, unknown>;
  age?: string;
  snapshotOffset?: string;
};
async function seedRequest(options: RequestOptions = {}): Promise<string> {
  const id = randomUUID();
  const tenant = options.tenant ?? org;
  const user = options.user ?? requester;
  await sql(
    `insert into audit_exports
       (id, tenant_id, requested_by, format, filters, time_zone, snapshot_at, created_at)
     values ($1, $2, $3, $4, $5::jsonb, 'Asia/Bangkok',
             now() + $6::interval, now() - $7::interval)`,
    [
      id,
      tenant,
      user,
      options.format ?? "csv",
      JSON.stringify({
        from: new Date(Date.now() - 400 * DAY).toISOString(),
        to: new Date(Date.now() + DAY).toISOString(),
        categories: [],
        actorUserId: null,
        q: null,
        ...options.filters,
      }),
      options.snapshotOffset ?? "1 hour",
      options.age ?? "0 seconds",
    ],
  );
  await sql(
    `insert into audit_export_jobs (export_id, tenant_id, requested_by, state, created_at)
     select id, tenant_id, requested_by, 'queued', created_at from audit_exports where id = $1`,
    [id],
  );
  return id;
}

async function exportRow(id: string) {
  const rows = await sql<{
    state: string;
    attempt_count: number;
    claim_token: string | null;
    content: Buffer | null;
    row_count: number | null;
    byte_size: number | null;
    failure_code: string | null;
    completed_at: Date | null;
    file_expires_at: Date | null;
  }>(
    `select j.state, j.attempt_count, j.claim_token, e.content, e.row_count,
            e.byte_size, e.failure_code, e.completed_at, e.file_expires_at
     from audit_exports e join audit_export_jobs j on j.export_id = e.id
     where e.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("export missing");
  return row;
}

/** Waits until some session of the test database is blocked on a lock. */
async function waitUntilBlocked(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql(
      "select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("no session ever waited on a lock");
}

async function intentsFor(id: string) {
  return sql<{ event_type: string; recipient_user_id: string }>(
    `select i.event_type, r.recipient_user_id
     from notification_intents i
     join notification_intent_recipients r on r.intent_id = i.id
     where i.subject_audit_export_id = $1 order by i.event_type`,
    [id],
  );
}

async function resetAll() {
  await sql("delete from audit_exports");
  await sql("delete from notification_intents");
  await sql("delete from audit_events");
  lines.length = 0;
}

/** Minimal RFC 4180 reader for the files under test. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch ?? "";
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += ch ?? "";
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const contentOf = async (id: string) => {
  const row = await exportRow(id);
  if (!row.content) throw new Error("no file");
  return row.content.toString("utf8");
};

beforeAll(async () => {
  ({ database: runtime, owner, close } = await openIsolatedDatabase());
  await sql(
    "insert into organization (id, name, slug, audit_recording_started_at) values ($1, 'A', $2, now() - interval '400 days'), ($3, 'B', $4, now() - interval '400 days')",
    [org, `a-${run}`, otherOrg, `b-${run}`],
  );
  await addUser(requester, "Requester", "admin");
  await addUser(colleague, "Colleague", "owner");
  await addUser(outsider, "Outsider");
  const now = Date.now();
  for (const days of [200, 364, 365, 366]) {
    await ensureAuditPartitionFor(owner, new Date(now - days * DAY));
  }
}, 180_000);

afterAll(async () => {
  await close();
}, 60_000);

beforeEach(resetAll);

describe("the file (AC-15, AC-24, AC-26)", () => {
  it("writes a CSV with one row per event, in order, with real field values, guards formulas, and keeps secrets out", async () => {
    const monitorId = randomUUID();
    await sql(
      `insert into monitors (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
       values ($1, $2, $3, 'https://x.example.test/', 60, 10, $4)`,
      [monitorId, org, MONITOR_NAME, randomUUID()],
    );
    const changes: AuditChange[] = [
      {
        field: "name",
        before: { kind: "value", value: "old" },
        after: { kind: "value", value: MONITOR_NAME },
      },
      {
        field: "secret",
        key: "auth.token",
        before: null,
        after: { kind: "secret_set" },
      },
      {
        field: "queryParam",
        key: "token",
        before: { kind: "masked" },
        after: { kind: "masked" },
      },
    ];
    const monitorEvent = await seedEvent({
      actor: colleague,
      actorRole: "owner",
      category: "monitor",
      action: "organization.monitor.update",
      targetType: "monitor",
      targetId: monitorId,
      changes,
      at: "now() - interval '2 minutes'",
    });
    const invitationEvent = await seedEvent({
      category: "invitation",
      action: "organization.invitation.create",
      targetType: "invitation",
      targetId: "0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a11",
      attributes: { role: "viewer" },
      at: "now() - interval '1 minute'",
    });
    const id = await seedRequest({ format: "csv" });
    expect(await exporter().runOnce()).toBe(true);

    const row = await exportRow(id);
    expect(row).toMatchObject({
      state: "ready",
      row_count: 2,
      failure_code: null,
    });
    expect(row.byte_size).toBe(row.content?.length);
    expect(row.completed_at).toBeInstanceOf(Date);
    const ttlHours =
      ((row.file_expires_at?.getTime() ?? 0) -
        (row.completed_at?.getTime() ?? 0)) /
      3_600_000;
    expect(ttlHours).toBeCloseTo(24, 1);

    const text = await contentOf(id);
    // The preamble and header row layout is covered by file.test.ts:79; here
    // only the two event rows that follow it matter.
    const rows = parseCsv(text.slice(1));
    const [newest, oldest] = [rows[6], rows[7]];
    // Newest first, like the page.
    expect(newest?.[1]).toBe(invitationEvent);
    expect(oldest?.[1]).toBe(monitorEvent);
    expect(newest?.slice(2)).toEqual([
      "Requester",
      "admin",
      "สร้างคำเชิญ",
      "organization.invitation.create",
      "invitation",
      "คำเชิญ role viewer (0b6f9a52-3b7c-4f0d-9f5b-2d6f5e0d1a11)",
      "",
    ]);
    expect(oldest?.[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(oldest?.slice(2, 8)).toEqual([
      "Colleague",
      "owner",
      "แก้ไขมอนิเตอร์",
      "organization.monitor.update",
      "monitor",
      `'${MONITOR_NAME}`,
    ]);
    expect(oldest?.[8]).toContain("secret (auth.token): - → ตั้งค่าแล้ว");
    expect(oldest?.[8]).toContain("queryParam (token): ••• → •••");
    expect(text).not.toContain(SECRET_VALUE);
    // The formula never starts a cell.
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain(requester);

    expect(await intentsFor(id)).toEqual([
      { event_type: "AUDIT_EXPORT_READY", recipient_user_id: requester },
    ]);
  });

  it("writes JSON whose events carry the fields of the detail page and valid changes", async () => {
    const changes: AuditChange[] = [
      {
        field: "role",
        before: { kind: "value", value: "viewer" },
        after: { kind: "value", value: "admin" },
      },
    ];
    const eventId = await seedEvent({
      category: "member",
      action: "organization.member.role.update",
      targetType: "member",
      targetId: colleague,
      changes,
    });
    const id = await seedRequest({ format: "json" });
    await exporter().runOnce();
    const parsed = JSON.parse(await contentOf(id)) as {
      meta: Record<string, string>;
      events: Record<string, unknown>[];
    };
    expect(Object.keys(parsed.meta).sort()).toEqual([
      "filters",
      "generatedAt",
      "scopeNote",
      "timeZone",
    ]);
    expect(parsed.meta.timeZone).toBe("Asia/Bangkok");
    expect(parsed.events).toEqual([
      {
        id: eventId,
        occurredAt: expect.stringMatching(/Z$/) as unknown,
        actor: {
          displayName: "Requester",
          roleAtTime: "admin",
          membership: "current",
        },
        action: "organization.member.role.update",
        actionLabel: "เปลี่ยนบทบาทสมาชิก",
        category: "member",
        target: "Colleague",
        changes,
      },
    ]);
  });

  it("records only that a search was used, never its text, in the CSV preamble and the JSON meta", async () => {
    await seedEvent();
    const search = `${requester}@example.test`;
    const csv = await seedRequest({ format: "csv", filters: { q: search } });
    const json = await seedRequest({
      format: "json",
      user: colleague,
      filters: { q: search },
    });
    await exporter().runOnce();
    await exporter().runOnce();
    const csvText = await contentOf(csv);
    const jsonText = await contentOf(json);
    for (const text of [csvText, jsonText]) {
      expect(text).toContain("search=applied");
      expect(text).not.toContain(search);
      expect(text).not.toContain("@example.test");
    }
    expect(parseCsv(csvText.slice(1))[2]?.[1]).toContain("search=applied");
    expect(
      (JSON.parse(jsonText) as { meta: { filters: string } }).meta.filters,
    ).toContain("search=applied");
  });

  it("holds events inside 365 days only, up to the snapshot, and clamps from to the recording start", async () => {
    const ids = {
      young: await seedEvent({ at: "now() - interval '364 days'" }),
      edge: await seedEvent({
        at: "now() - interval '364 days 23 hours 59 minutes'",
      }),
      old: await seedEvent({ at: "now() - interval '365 days 1 minute'" }),
      older: await seedEvent({ at: "now() - interval '366 days'" }),
      late: await seedEvent({ at: "now() + interval '2 hours'" }),
    };
    const id = await seedRequest({
      format: "json",
      snapshotOffset: "30 minutes",
    });
    await exporter().runOnce();
    const parsed = JSON.parse(await contentOf(id)) as {
      events: { id: string }[];
    };
    expect(parsed.events.map((e) => e.id).sort()).toEqual(
      [ids.young, ids.edge].sort(),
    );

    // A recording start newer than the events hides them, whatever `from` says.
    await sql(
      "update organization set audit_recording_started_at = now() - interval '100 days' where id = $1",
      [org],
    );
    const clamped = await seedRequest({ format: "json", user: colleague });
    await exporter().runOnce();
    expect(
      (JSON.parse(await contentOf(clamped)) as { events: unknown[] }).events,
    ).toEqual([]);
  });

  it("fixes the retention window once per job, so a row near the boundary stays in every batch", async () => {
    await sql(
      "update organization set audit_recording_started_at = now() - interval '400 days' where id = $1",
      [org],
    );
    const newest = await seedEvent({ at: "now() - interval '1 minute'" });
    // One hour inside the window when generation starts.
    const nearBoundary = await seedEvent({
      at: "now() - interval '364 days 23 hours'",
    });
    const older = await seedEvent({ at: "now() - interval '200 days'" });
    const id = await seedRequest({ format: "json" });
    // The clock jumps 2 days after the first reading: a window recomputed for
    // each batch would then drop the row that is one hour inside the boundary.
    let reads = 0;
    const start = Date.now();
    await exporter({
      batchSize: 1,
      timeLimitMs: 1e9,
      now: () => new Date(start + (reads++ === 0 ? 0 : 2 * DAY)),
    }).runOnce();
    const out = (
      JSON.parse(await contentOf(id)) as { events: { id: string }[] }
    ).events.map((event) => event.id);
    expect(out).toEqual([newest, older, nearBoundary]);
  });

  it("applies category, actor, time and search filters like the list", async () => {
    const monitorId = randomUUID();
    await sql(
      `insert into monitors (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
       values ($1, $2, 'Checkout API', 'https://x.example.test/', 60, 10, $3)`,
      [monitorId, org, randomUUID()],
    );
    const monitorEvent = await seedEvent({
      actor: colleague,
      actorRole: "owner",
      category: "monitor",
      action: "organization.monitor.pause",
      targetType: "monitor",
      targetId: monitorId,
      at: "now() - interval '3 hours'",
    });
    const memberEvent = await seedEvent({ at: "now() - interval '1 hour'" });
    const run1 = async (filters: Record<string, unknown>) => {
      const id = await seedRequest({
        format: "json",
        filters,
        user: requester,
      });
      await sql(
        "update audit_export_jobs set state = 'queued' where export_id = $1",
        [id],
      );
      await exporter().runOnce();
      const out = (
        JSON.parse(await contentOf(id)) as { events: { id: string }[] }
      ).events.map((e) => e.id);
      await sql("delete from audit_exports where id = $1", [id]);
      return out;
    };
    expect(await run1({ categories: ["monitor"] })).toEqual([monitorEvent]);
    expect(await run1({ actorUserId: requester })).toEqual([memberEvent]);
    expect(
      await run1({ from: new Date(Date.now() - 2 * 3_600_000).toISOString() }),
    ).toEqual([memberEvent]);
    expect(await run1({ q: "checkout" })).toEqual([monitorEvent]);
    expect(await run1({ q: "หยุดมอนิเตอร์" })).toEqual([monitorEvent]);
    expect(await run1({ q: `${requester}@example.test` })).toEqual([]);
  });

  it("reads in batches without losing or repeating events that share a timestamp", async () => {
    await sql(
      `insert into audit_events
         (tenant_id, occurred_at, actor_user_id, actor_role, category, action, target_type, target_id)
       select $1, now() - interval '10 days' + (g / 3) * interval '1 microsecond',
              $2, 'admin', 'member', 'organization.member.leave', 'member', $2
       from generate_series(1, 11) g`,
      [org, requester],
    );
    const expected = (
      await sql<{ id: string }>(
        "select id from audit_events where tenant_id = $1 order by occurred_at desc, id desc",
        [org],
      )
    ).map((row) => row.id);
    const id = await seedRequest({ format: "json" });
    await exporter({ batchSize: 3 }).runOnce();
    const out = (
      JSON.parse(await contentOf(id)) as { events: { id: string }[] }
    ).events;
    expect(out.map((e) => e.id)).toEqual(expected);
    expect(new Set(out.map((e) => e.id)).size).toBe(11);
  });
});

describe("failure outcomes (P-07, P-01)", () => {
  it("fails with EXPORT_TOO_LARGE past the size limit and tells the requester", async () => {
    for (let i = 0; i < 20; i += 1) await seedEvent();
    const id = await seedRequest();
    await exporter({ maxBytes: 600 }).runOnce();
    expect(await exportRow(id)).toMatchObject({
      state: "failed",
      failure_code: "EXPORT_TOO_LARGE",
      content: null,
    });
    expect(await intentsFor(id)).toEqual([
      { event_type: "AUDIT_EXPORT_FAILED", recipient_user_id: requester },
    ]);
  });

  it("fails when there are more events than the limit", async () => {
    for (let i = 0; i < 5; i += 1) await seedEvent();
    const id = await seedRequest();
    await exporter({ maxEvents: 3 }).runOnce();
    expect(await exportRow(id)).toMatchObject({
      state: "failed",
      failure_code: "EXPORT_TOO_LARGE",
    });
  });

  it("fails a requester who is no longer owner or admin, and notifies only while they are a member", async () => {
    await seedEvent();
    await sql("update member set role = 'viewer' where user_id = $1", [
      requester,
    ]);
    const demoted = await seedRequest();
    await exporter().runOnce();
    expect(await exportRow(demoted)).toMatchObject({
      state: "failed",
      failure_code: "REQUESTER_NOT_AUTHORIZED",
      content: null,
    });
    expect(await intentsFor(demoted)).toEqual([
      { event_type: "AUDIT_EXPORT_FAILED", recipient_user_id: requester },
    ]);

    await sql("delete from member where user_id = $1", [requester]);
    const removed = await seedRequest();
    await exporter().runOnce();
    expect(await exportRow(removed)).toMatchObject({
      state: "failed",
      failure_code: "REQUESTER_NOT_AUTHORIZED",
    });
    expect(await intentsFor(removed)).toEqual([]);
    await sql(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin')",
      [randomUUID(), org, requester],
    );
  });

  it("treats a composite stored role by its highest-priority token", async () => {
    await seedEvent();
    await sql("update member set role = 'viewer,auditor' where user_id = $1", [
      requester,
    ]);
    const id = await seedRequest();
    await exporter().runOnce();
    expect(await exportRow(id)).toMatchObject({
      failure_code: "REQUESTER_NOT_AUTHORIZED",
    });
    await sql("update member set role = 'auditor,admin' where user_id = $1", [
      requester,
    ]);
    const ok = await seedRequest();
    await exporter().runOnce();
    expect((await exportRow(ok)).state).toBe("ready");
    await sql("update member set role = 'admin' where user_id = $1", [
      requester,
    ]);
  });

  it("fails the fourth claim and a claim from minute 50 with EXPORT_FAILED and no file", async () => {
    await seedEvent();
    const fourth = await seedRequest();
    await sql(
      "update audit_export_jobs set attempt_count = 3 where export_id = $1",
      [fourth],
    );
    await exporter().runOnce();
    expect(await exportRow(fourth)).toMatchObject({
      state: "failed",
      failure_code: "EXPORT_FAILED",
      content: null,
    });
    expect(await intentsFor(fourth)).toHaveLength(1);

    const late = await seedRequest({ age: "51 minutes", user: colleague });
    await exporter().runOnce();
    expect(await exportRow(late)).toMatchObject({
      state: "failed",
      failure_code: "EXPORT_FAILED",
      content: null,
    });
  });
});

describe("races (AC-25)", () => {
  it("lets two exporters claim different requests at once", async () => {
    await seedEvent();
    const a = await seedRequest({ user: requester });
    const b = await seedRequest({ user: colleague });
    const results = await Promise.all([
      exporter().runOnce(),
      exporter().runOnce(),
    ]);
    expect(results).toEqual([true, true]);
    expect((await exportRow(a)).state).toBe("ready");
    expect((await exportRow(b)).state).toBe("ready");
    expect((await exportRow(a)).attempt_count).toBe(1);
    expect((await exportRow(b)).attempt_count).toBe(1);
  });

  it("drops the result of a holder whose lease ran out and keeps the new holder's file", async () => {
    await seedEvent();
    const id = await seedRequest({ format: "json" });
    const first = await claimAuditExport(runtime);
    expect(first?.exportId).toBe(id);
    await sql(
      "update audit_export_jobs set claimed_until = now() - interval '1 second' where export_id = $1",
      [id],
    );
    const second = await claimAuditExport(runtime);
    expect(second?.exportId).toBe(id);
    expect(second?.claimToken).not.toBe(first?.claimToken);
    if (!first || !second) throw new Error("claims missing");

    expect(await exporter().process(second)).toBe("ready");
    const stored = await contentOf(id);
    // The stale holder finishes later (and would fail the request too): both lose.
    expect(await exporter().process(first)).toBe("discarded");
    expect(await exporter().process({ ...first, exhausted: true })).toBe(
      "discarded",
    );
    expect(await contentOf(id)).toBe(stored);
    expect((await exportRow(id)).state).toBe("ready");
    expect(await intentsFor(id)).toHaveLength(1);
  });

  it("drops a stale holder that finishes while the new holder is still working", async () => {
    await seedEvent();
    const id = await seedRequest();
    const first = await claimAuditExport(runtime);
    await sql(
      "update audit_export_jobs set claimed_until = now() - interval '1 second' where export_id = $1",
      [id],
    );
    const second = await claimAuditExport(runtime);
    if (!first || !second) throw new Error("claims missing");
    expect(await exporter().process(first)).toBe("discarded");
    expect(await exportRow(id)).toMatchObject({
      state: "running",
      content: null,
    });
    expect(await exporter().process(second)).toBe("ready");
  });

  it("never turns a request that the deadline already failed into ready, and the other order keeps ready", async () => {
    await seedEvent();
    const late = await seedRequest({ age: "55 minutes" });
    const claim = await claimAuditExport(runtime);
    if (!claim) throw new Error("claim missing");
    // Claimed before the deadline passes, then the 60 minutes run out.
    await sql(
      "update audit_exports set created_at = now() - interval '61 minutes' where id = $1",
      [late],
    );
    await sql(
      "update audit_export_jobs set created_at = now() - interval '61 minutes' where export_id = $1",
      [late],
    );
    const failed = await withTenantUserContextRaw(
      runtime,
      org,
      requester,
      (client) =>
        failStaleAuditExports(client, {
          tenantId: org,
          requestedBy: requester,
          exportId: late,
        }),
    );
    expect(failed).toEqual([late]);
    expect(await exporter().process({ ...claim, exhausted: false })).toBe(
      "discarded",
    );
    expect(await exportRow(late)).toMatchObject({
      state: "failed",
      failure_code: "EXPORT_FAILED",
      content: null,
    });
    expect(await intentsFor(late)).toEqual([
      { event_type: "AUDIT_EXPORT_FAILED", recipient_user_id: requester },
    ]);

    // Complete first: ready wins and the sweep finds nothing to fail.
    const early = await seedRequest({ user: colleague });
    const earlyClaim = await claimAuditExport(runtime);
    if (!earlyClaim) throw new Error("claim missing");
    expect(await exporter().process(earlyClaim)).toBe("ready");
    await sql(
      "update audit_exports set created_at = now() - interval '61 minutes' where id = $1",
      [early],
    );
    await sql(
      "update audit_export_jobs set created_at = now() - interval '61 minutes' where export_id = $1",
      [early],
    );
    const none = await withTenantUserContextRaw(
      runtime,
      org,
      colleague,
      (client) =>
        failStaleAuditExports(client, {
          tenantId: org,
          requestedBy: colleague,
        }),
    );
    expect(none).toEqual([]);
    expect((await exportRow(early)).state).toBe("ready");
    expect(await intentsFor(early)).toEqual([
      { event_type: "AUDIT_EXPORT_READY", recipient_user_id: colleague },
    ]);
  });

  it("fails with REQUESTER_NOT_AUTHORIZED when the requester is demoted while batches are read, and tells them", async () => {
    for (let i = 0; i < 4; i += 1) await seedEvent();
    const id = await seedRequest({ format: "json" });
    let batches = 0;
    const result = await exporter({
      batchSize: 1,
      onBatch: async () => {
        batches += 1;
        if (batches === 2) {
          await sql("update member set role = 'viewer' where user_id = $1", [
            requester,
          ]);
        }
      },
    }).runOnce();
    expect(result).toBe(true);
    expect(await exportRow(id)).toMatchObject({
      state: "failed",
      failure_code: "REQUESTER_NOT_AUTHORIZED",
      content: null,
    });
    expect(await intentsFor(id)).toEqual([
      { event_type: "AUDIT_EXPORT_FAILED", recipient_user_id: requester },
    ]);
    await sql("update member set role = 'admin' where user_id = $1", [
      requester,
    ]);
  });

  it(
    "drops a result while a stale transition of the same request is still uncommitted, and keeps one failure notification",
    { timeout: 30_000 },
    async () => {
      await seedEvent();
      const id = await seedRequest({ age: "55 minutes" });
      const claim = await claimAuditExport(runtime);
      if (!claim) throw new Error("claim missing");
      await sql(
        "update audit_exports set created_at = now() - interval '61 minutes' where id = $1",
        [id],
      );
      await sql(
        "update audit_export_jobs set created_at = now() - interval '61 minutes' where export_id = $1",
        [id],
      );

      const holder = await runtime.sql.connect();
      try {
        await holder.query("begin");
        await holder.query("select set_config('app.tenant_id', $1, true)", [
          org,
        ]);
        await holder.query("select set_config('app.user_id', $1, true)", [
          requester,
        ]);
        expect(
          await failStaleAuditExports(holder, {
            tenantId: org,
            requestedBy: requester,
            exportId: id,
          }),
        ).toEqual([id]);
        // The complete statement skips the row at once: its own deadline check
        // is false for it, so there is nothing to wait for before the commit.
        const pending = exporter().process({ ...claim, exhausted: false });
        expect(await pending).toBe("discarded");
        await holder.query("commit");
      } finally {
        await holder.query("rollback").catch(() => undefined);
        holder.release();
      }
      expect(await exportRow(id)).toMatchObject({
        state: "failed",
        failure_code: "EXPORT_FAILED",
        content: null,
      });
      expect(await intentsFor(id)).toEqual([
        { event_type: "AUDIT_EXPORT_FAILED", recipient_user_id: requester },
      ]);
    },
  );

  it("drops a result whose complete waited on the organization lock past the deadline while a stale transition committed", async () => {
    await seedEvent();
    const id = await seedRequest();
    const claim = await claimAuditExport(runtime);
    if (!claim) throw new Error("claim missing");
    // The deadline falls 3 seconds from now: complete's transaction starts
    // before it (now() is the transaction start) and is held until after it.
    await sql(
      "update audit_exports set created_at = now() - interval '59 minutes 57 seconds' where id = $1",
      [id],
    );
    await sql(
      "update audit_export_jobs set created_at = now() - interval '59 minutes 57 seconds' where export_id = $1",
      [id],
    );

    // NO KEY UPDATE blocks complete's FOR SHARE but not the foreign key lock
    // of the stale notification, so the stale transition can commit meanwhile.
    const holder = await runtime.sql.connect();
    let pending: Promise<string> | undefined;
    try {
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for no key update",
        [org],
      );
      pending = exporter().process({ ...claim, exhausted: false });
      await waitUntilBlocked();
      await new Promise((resolve) => setTimeout(resolve, 3_200));
      expect(
        await withTenantUserContextRaw(runtime, org, requester, (client) =>
          failStaleAuditExports(client, {
            tenantId: org,
            requestedBy: requester,
            exportId: id,
          }),
        ),
      ).toEqual([id]);
      await holder.query("commit");
      expect(await pending).toBe("discarded");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
      await pending?.catch(() => undefined);
    }
    expect(await exportRow(id)).toMatchObject({
      state: "failed",
      failure_code: "EXPORT_FAILED",
      content: null,
    });
    expect(await intentsFor(id)).toEqual([
      { event_type: "AUDIT_EXPORT_FAILED", recipient_user_id: requester },
    ]);
  }, 30_000);

  it("keeps the ready result when a stale transition waits on the lock of the uncommitted complete, and raises one ready notification", async () => {
    await seedEvent();
    const id = await seedRequest();
    const claim = await claimAuditExport(runtime);
    if (!claim) throw new Error("claim missing");
    // 3 seconds of life left: the complete passes the deadline check, then the
    // deadline passes while it still holds the row.
    await sql(
      "update audit_exports set created_at = now() - interval '59 minutes 57 seconds' where id = $1",
      [id],
    );
    await sql(
      "update audit_export_jobs set created_at = now() - interval '59 minutes 57 seconds' where export_id = $1",
      [id],
    );
    let stale: Promise<string[]> | undefined;
    const result = await exporter({
      onCompleting: async () => {
        // The stale update matches the row, and so waits for its lock, only
        // once the deadline has passed.
        await new Promise((resolve) => setTimeout(resolve, 3_200));
        stale = withTenantUserContextRaw(runtime, org, requester, (client) =>
          failStaleAuditExports(client, {
            tenantId: org,
            requestedBy: requester,
            exportId: id,
          }),
        );
        await waitUntilBlocked();
      },
    }).process({ ...claim, exhausted: false });
    expect(result).toBe("ready");
    expect(await stale).toEqual([]);
    expect(await exportRow(id)).toMatchObject({
      state: "ready",
      failure_code: null,
    });
    expect(await intentsFor(id)).toEqual([
      { event_type: "AUDIT_EXPORT_READY", recipient_user_id: requester },
    ]);
  }, 30_000);

  it("writes nothing when shutdown stops a build, and the request is claimed and finished afterwards", async () => {
    for (let i = 0; i < 6; i += 1) await seedEvent();
    const id = await seedRequest();
    let batches = 0;
    const stopping = exporter({
      batchSize: 2,
      onBatch: () => {
        batches += 1;
        if (batches === 1) void stopping.stop();
      },
    });
    expect(await stopping.runOnce()).toBe(true);
    expect(await exportRow(id)).toMatchObject({
      state: "running",
      content: null,
      attempt_count: 1,
    });
    expect(await intentsFor(id)).toEqual([]);
    // A stopped exporter claims nothing more.
    expect(await stopping.runOnce()).toBe(false);

    await sql(
      "update audit_export_jobs set claimed_until = now() - interval '1 second' where export_id = $1",
      [id],
    );
    expect(await exporter().runOnce()).toBe(true);
    expect(await exportRow(id)).toMatchObject({
      state: "ready",
      attempt_count: 2,
    });
  });

  it("gives up after a time limit without writing, to be claimed again", async () => {
    for (let i = 0; i < 4; i += 1) await seedEvent();
    const id = await seedRequest();
    let ticks = 0;
    const limited = exporter({
      batchSize: 1,
      timeLimitMs: 1_000,
      now: () => new Date(Date.now() + ticks++ * 600),
    });
    expect(await limited.runOnce()).toBe(true);
    expect(await exportRow(id)).toMatchObject({
      state: "running",
      content: null,
    });
  });
});

describe("worker log (AC-26)", () => {
  it("names only the export and the result", async () => {
    await seedEvent({
      changes: [
        {
          field: "name",
          before: null,
          after: { kind: "value", value: SECRET_VALUE },
        },
      ],
    });
    const id = await seedRequest({ filters: { q: `needle-${run}` } });
    await seedRequest({ user: colleague });
    await exporter().runOnce();
    await exporter().runOnce();
    const text = lines.join("\n");
    expect(text).toContain(id);
    for (const hidden of [
      `needle-${run}`,
      SECRET_VALUE,
      "Requester",
      "Colleague",
      requester,
      "Asia/Bangkok",
      org,
    ]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe("notifications reach the requester (P-07)", () => {
  it("materializes a failure for a requester who is a viewer now, and the ready item with its export id", async () => {
    await seedEvent();
    await sql("update member set role = 'viewer' where user_id = $1", [
      requester,
    ]);
    const failed = await seedRequest();
    await exporter().runOnce();
    await sql("update member set role = 'admin' where user_id = $1", [
      requester,
    ]);
    const ready = await seedRequest();
    await exporter().runOnce();

    const claimToken = randomUUID();
    const claims = await claimNotificationDispatches(runtime, {
      claimToken,
      limit: 10,
    });
    expect(claims).toHaveLength(2);
    const dependencies = createMaterializationDependencies(runtime);
    for (const claim of claims) {
      if (!claim.tenantId) throw new Error("tenant scope expected");
      await markNotificationDispatchEnqueued(runtime, {
        id: claim.id,
        claimToken,
      });
      await processMaterialization(
        {
          dispatchId: claim.id,
          claimToken,
          scope: { kind: "tenant", tenantId: claim.tenantId },
        },
        dependencies,
      );
    }
    const items = await sql<{
      event_type: string;
      recipient_user_id: string;
      subject_audit_export_id: string;
    }>(
      `select event_type, recipient_user_id, subject_audit_export_id
       from notification_inbox_items where tenant_id = $1 order by event_type`,
      [org],
    );
    expect(items).toEqual([
      {
        event_type: "AUDIT_EXPORT_FAILED",
        recipient_user_id: requester,
        subject_audit_export_id: failed,
      },
      {
        event_type: "AUDIT_EXPORT_READY",
        recipient_user_id: requester,
        subject_audit_export_id: ready,
      },
    ]);
  });
});

describe("stale sweep by the scheduler (P-08)", () => {
  // The sweep never touches the queue; only add() exists on the double.
  const queue = {
    add: () => Promise.reject(new Error("no queue")),
  } as unknown as DispatchQueue;

  it("fails late requests without an audit-exporter, leaves ready and failed rows alone, one notification each", async () => {
    await seedEvent();
    const late = await seedRequest({ age: "61 minutes" });
    const lateRunning = await seedRequest({ age: "3 hours", user: colleague });
    await sql(
      "update audit_export_jobs set state = 'running' where export_id = $1",
      [lateRunning],
    );
    const ready = await seedRequest({
      age: "2 hours",
      user: outsider,
      tenant: org,
    });
    await sql(
      "update audit_export_jobs set state = 'ready' where export_id = $1",
      [ready],
    );
    const fresh = await seedRequest({
      age: "5 minutes",
      tenant: otherOrg,
      user: requester,
    });
    const scheduler = new NotificationDispatchScheduler(runtime, queue, logger);
    await scheduler.dispatch();
    await scheduler.dispatch();
    expect((await exportRow(late)).state).toBe("failed");
    expect((await exportRow(lateRunning)).state).toBe("failed");
    expect((await exportRow(ready)).state).toBe("ready");
    expect((await exportRow(fresh)).state).toBe("queued");
    expect(await intentsFor(late)).toHaveLength(1);
    expect(await intentsFor(lateRunning)).toHaveLength(1);
    expect(await intentsFor(ready)).toEqual([]);
  });

  it("does not let a sweep fault stop the dispatch steps of the cycle", async () => {
    await seedEvent();
    const late = await seedRequest({ age: "61 minutes" });
    const failing = new Proxy(runtime, {
      get(target, property, receiver) {
        if (property !== "sql")
          return Reflect.get(target, property, receiver) as unknown;
        return new Proxy(target.sql, {
          get(pool, key, poolReceiver) {
            if (key !== "query")
              return Reflect.get(pool, key, poolReceiver) as unknown;
            return (text: unknown, ...rest: unknown[]) =>
              typeof text === "string" &&
              text.includes("find_stale_audit_exports")
                ? Promise.reject(new Error("sweep down"))
                : (pool.query as (...a: unknown[]) => unknown)(text, ...rest);
          },
        });
      },
    });
    const scheduler = new NotificationDispatchScheduler(failing, queue, logger);
    await expect(scheduler.dispatch()).resolves.toBeUndefined();
    expect((await exportRow(late)).state).toBe("queued");
    expect(lines.join("\n")).toContain("stale audit export sweep failed");
    // The next healthy cycle catches up.
    await new NotificationDispatchScheduler(runtime, queue, logger).dispatch();
    expect((await exportRow(late)).state).toBe("failed");
  });
});

describe("maintenance", () => {
  it("drains more due export files than one batch holds in a single run", async () => {
    await sql(
      `insert into audit_exports
         (tenant_id, requested_by, format, filters, time_zone, snapshot_at,
          content, file_expires_at)
       select $1, $2, 'csv', '{}'::jsonb, 'UTC', now(), '\\x01'::bytea,
              now() - interval '1 hour'
       from generate_series(1, 1200)`,
      [org, requester],
    );
    const due = async () =>
      (
        await sql<{ n: number }>(
          `select count(*)::int as n from audit_exports
           where file_expires_at <= now() and content_purged_at is null`,
        )
      )[0]?.n;
    expect(await due()).toBe(1200);
    await runAuditMaintenance(runtime, logger);
    expect(await due()).toBe(0);
    expect(lines.join("\n")).not.toContain("batch guard");
  });

  it("purges events past 365 days and old exports, and warns about a short partition horizon", async () => {
    const old = await seedEvent({ at: "now() - interval '365 days 1 hour'" });
    const kept = await seedEvent({ at: "now() - interval '1 day'" });
    const oldExport = await seedRequest({ age: "8 days", user: requester });
    await sql(
      "update audit_export_jobs set state = 'failed' where export_id = $1",
      [oldExport],
    );
    await runAuditMaintenance(runtime, logger);
    const ids = (await sql<{ id: string }>("select id from audit_events")).map(
      (r) => r.id,
    );
    expect(ids).toEqual([kept]);
    expect(ids).not.toContain(old);
    expect(
      await sql("select 1 from audit_exports where id = $1", [oldExport]),
    ).toHaveLength(0);
    expect(lines.join("\n")).not.toContain("partitions ahead");

    await runAuditMaintenance(
      runtime,
      logger,
      new Date(Date.now() + 700 * DAY),
    );
    expect(lines.join("\n")).toContain(
      "audit_events partitions ahead are below the required horizon",
    );
  });
});
