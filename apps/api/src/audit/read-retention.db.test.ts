import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { Database } from "@nightwatch/db";

import {
  getAuditEvent,
  listAuditActors,
  listAuditEvents,
} from "./read-service";
import {
  createAuditPartitionFor,
  openIsolatedAuditDatabase,
} from "./test-support";

// Seeds events in past months, so partitions are created: own database.
let database: Database;
let owner: Client;
let close: () => Promise<void>;
const run = crypto.randomUUID().slice(0, 8);
const org = crypto.randomUUID();
const reader = `ret-reader-${run}`;
const onlyExpiredActor = `ret-expired-${run}`;
const liveActor = `ret-live-${run}`;
const DAY = 24 * 3600 * 1000;
const events: Record<string, string> = {};

async function seed(actor: string, age: string): Promise<string> {
  const result = await owner.query<{ id: string }>(
    `insert into audit_events
       (tenant_id, occurred_at, actor_user_id, actor_role, category, action, target_type, target_id)
     values ($1, now() - $2::interval, $3, 'owner', 'member',
             'organization.member.leave', 'member', $3)
     returning id`,
    [org, age, actor],
  );
  return result.rows[0]?.id ?? "";
}

const identity = { organizationId: org, actorUserId: reader };
const query = { limit: 50, offset: 0 } as const;

beforeAll(async () => {
  ({ database, owner, close } = await openIsolatedAuditDatabase());
  await owner.query(
    `insert into organization (id, name, slug, audit_recording_started_at)
     values ($1, 'Retention', $2, now() - interval '400 days')`,
    [org, `retention-${run}`],
  );
  for (const id of [reader, onlyExpiredActor, liveActor]) {
    await owner.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $1, $2, true, now(), now())`,
      [id, `${id}@example.test`],
    );
    await owner.query(
      `insert into member (id, organization_id, user_id, role)
       values ($1, $2, $3, $4)`,
      [crypto.randomUUID(), org, id, id === reader ? "auditor" : "viewer"],
    );
  }
  const now = Date.now();
  for (const days of [364, 365, 366]) {
    await createAuditPartitionFor(owner, new Date(now - days * DAY));
  }
  events.live364 = await seed(liveActor, "364 days");
  events.live = await seed(liveActor, "364 days 23 hours 59 minutes");
  events.expired = await seed(onlyExpiredActor, "365 days 1 minute");
  events.expired366 = await seed(onlyExpiredActor, "366 days");
}, 180_000);

afterAll(async () => {
  await close();
}, 60_000);

describe("365-day cutoff on every read (AC-24)", () => {
  it("lists 364 days and 365 days minus a minute, not 365 days plus a minute or 366 days", async () => {
    const page = await listAuditEvents(database, identity, query);
    expect(page.events.map((event) => event.id).sort()).toEqual(
      [events.live364, events.live].sort(),
    );
    expect(page.page.total).toBe(2);
    expect(
      Math.abs(Date.parse(page.retainedFrom) - (Date.now() - 365 * DAY)),
    ).toBeLessThan(60_000);
  });

  it("answers 404 for an event past the cutoff and returns one inside it", async () => {
    await expect(
      getAuditEvent(database, identity, events.expired ?? ""),
    ).rejects.toMatchObject({ code: "AUDIT_EVENT_NOT_FOUND" });
    await expect(
      getAuditEvent(database, identity, events.expired366 ?? ""),
    ).rejects.toMatchObject({ code: "AUDIT_EVENT_NOT_FOUND" });
    const inside = await getAuditEvent(database, identity, events.live ?? "");
    expect(inside.event.id).toBe(events.live);
  });

  it("offers only actors with an event inside the window", async () => {
    const { actors } = await listAuditActors(database, identity);
    expect(actors.map((actor) => actor.userId)).toEqual([liveActor]);
  });
});

describe("recording start (AC-09)", () => {
  it("clamps retainedFrom to the later of the cutoff and the recording start", async () => {
    await owner.query(
      "update organization set audit_recording_started_at = now() - interval '100 days' where id = $1",
      [org],
    );
    const recent = await listAuditEvents(database, identity, query);
    expect(
      Math.abs(Date.parse(recent.retainedFrom) - (Date.now() - 100 * DAY)),
    ).toBeLessThan(60_000);
    expect(recent.recordingStartedAt).toBe(
      (
        await owner.query<{ at: Date }>(
          "select audit_recording_started_at as at from organization where id = $1",
          [org],
        )
      ).rows[0]?.at.toISOString(),
    );
    // Nothing recorded before the start is shown, even inside 365 days.
    expect(recent.events).toEqual([]);
    expect(recent.page.total).toBe(0);

    await owner.query(
      "update organization set audit_recording_started_at = now() - interval '400 days' where id = $1",
      [org],
    );
    const old = await listAuditEvents(database, identity, query);
    expect(
      Math.abs(Date.parse(old.retainedFrom) - (Date.now() - 365 * DAY)),
    ).toBeLessThan(60_000);
    expect(old.page.total).toBe(2);
  });
});
