import { invitationCreateResponseSchema } from "@nightwatch/api-contract";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Mailer, OutboundMail } from "../auth/mailer";
import { createInvitationTestApp } from "./invitation-test-app";
import { createInvitationFixture } from "./invitation-test-support";

const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const absentOrg = crypto.randomUUID();
const fixture = createInvitationFixture([
  "owner",
  "admin",
  "viewer",
  "auditor",
  "other",
  "both",
]);
const { runtimeUrl, runtime, owner, run, actorIds, email } = fixture;
const mail: OutboundMail[] = [];
let failMail = false;
const mailer: Mailer = {
  send: (message) => {
    mail.push(message);
    return failMail
      ? Promise.reject(new Error(`smtp ${message.to} ${message.text}`))
      : Promise.resolve();
  },
  verify: () => Promise.resolve(),
};
const { app, logs } = createInvitationTestApp({
  database: runtime,
  runtimeUrl,
  secret: `invite-${run}`,
  actorIds,
  actorEmail: email,
  loggerName: "invitation-db-test",
  mailer,
});

async function request(
  actor: string,
  org: string,
  email: string,
  role = "viewer",
) {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-actor": actor },
    body: JSON.stringify({ email, role }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
async function rows(org = orgA) {
  return (
    await owner.sql.query<{
      email: string;
      role: string;
      status: string;
      expiresAt: Date;
    }>(
      `select email, role, status, expires_at as "expiresAt" from invitation where organization_id = $1`,
      [org],
    )
  ).rows;
}

async function waitForInvitationLocks(
  holderPid: number,
  requestPids: Set<number>,
  count: number,
) {
  await vi.waitFor(
    async () => {
      const waiting = await owner.sql.query<{ pid: number }>(
        `with recursive blocked(pid) as (
           select $1::int
           union
           select activity.pid from pg_stat_activity activity
           join blocked on blocked.pid = any(pg_blocking_pids(activity.pid))
           where activity.pid = any($2::int[])
         )
         select pid from blocked where pid <> $1`,
        [holderPid, [...requestPids]],
      );
      expect(waiting.rows).toHaveLength(count);
    },
    { timeout: 5_000, interval: 20 },
  );
}

beforeAll(async () => {
  await fixture.initialize(
    [
      [orgA, "Invite A", `invite-a-${run}`],
      [orgB, "Invite B", `invite-b-${run}`],
    ],
    [
      ...["owner", "admin", "viewer", "auditor", "both"].map(
        (role): [string, string, string] => [
          orgA,
          role,
          role === "both" ? "owner" : role,
        ],
      ),
      [orgB, "both", "admin"],
    ],
  );
}, 120_000);

afterAll(async () => {
  await fixture.close([orgA, orgB]);
});

describe("first-party invitation create", () => {
  it("enforces actor and invited role in the selected organization without probing absent organizations", async () => {
    for (const actor of ["owner", "admin", "viewer", "auditor", "other"]) {
      for (const role of ["owner", "admin", "viewer", "auditor"]) {
        const email = `${actor}-${role}-${run}@example.test`;
        const result = await request(actor, orgA, email, role);
        const permitted =
          actor === "owner" || (actor === "admin" && role !== "owner");
        expect(result.status).toBe(permitted ? 201 : 403);
        if (permitted)
          expect(invitationCreateResponseSchema.parse(result.body)).toEqual({
            created: true,
            emailDispatch: "accepted",
          });
        else
          expect(result.body).toMatchObject({
            error: {
              code:
                actor === "other" ? "MEMBERSHIP_DENIED" : "PERMISSION_DENIED",
              message:
                actor === "other"
                  ? "คุณไม่ใช่สมาชิกขององค์กรนี้"
                  : "คุณไม่มีสิทธิ์เชิญสมาชิก",
            },
          });
        expect((await rows()).some((row) => row.email === email)).toBe(
          permitted,
        );
      }
    }
    expect(await request("owner", orgB, `cross-${run}@example.test`)).toEqual(
      await request("owner", absentOrg, `cross-${run}@example.test`),
    );
    expect(
      (await request("both", orgB, `b-${run}@example.test`, "owner")).status,
    ).toBe(403);
    expect(
      (await request("both", orgB, `b-${run}@example.test`, "auditor")).status,
    ).toBe(201);
    expect((await rows(orgB)).map((row) => row.role)).toEqual(["auditor"]);
    const invalid = await request("owner", orgA, `invalid-${run}`);
    expect(invalid).toMatchObject({
      status: 400,
      body: { error: { code: "VALIDATION_ERROR" } },
    });
    const recorded = logs.join("\n");
    expect(recorded).not.toContain(orgA);
    expect(recorded).not.toContain(orgB);
    expect(recorded).not.toContain(`viewer-owner-${run}@example.test`);
    expect(recorded).not.toContain(`invalid-${run}`);
  });

  it("returns identical denied responses and audit/log events for existing or absent organization and target", async () => {
    const absentEmail = `absent-target-${run}@example.test`;
    const existingEmail = `owner-${run}@example.test`;
    const attempts = [
      { organizationId: orgA, email: existingEmail },
      { organizationId: orgA, email: absentEmail },
      { organizationId: absentOrg, email: existingEmail },
      { organizationId: absentOrg, email: absentEmail },
    ];
    const observed = [];
    for (const { organizationId, email } of attempts) {
      logs.length = 0;
      const response = await request("other", organizationId, email);
      const captured = logs.join("\n");
      for (const privateValue of [
        orgA,
        absentOrg,
        existingEmail,
        absentEmail,
        run,
        "test-session",
        "accept-invitation/",
      ]) {
        expect(captured).not.toContain(privateValue);
        expect(JSON.stringify(response)).not.toContain(privateValue);
      }
      const events = logs.map((line) =>
        Object.fromEntries(
          Object.entries(JSON.parse(line) as Record<string, unknown>).filter(
            ([key]) =>
              !["time", "pid", "hostname", "requestId", "durationMs"].includes(
                key,
              ),
          ),
        ),
      );
      expect(events).toEqual([
        {
          level: 40,
          name: "invitation-db-test",
          actorUserId: actorIds.other,
          action: "organization.invitation.create",
          code: "MEMBERSHIP_DENIED",
          msg: "organization access denied",
        },
        {
          level: 40,
          name: "invitation-db-test",
          code: "MEMBERSHIP_DENIED",
          msg: "request failed",
        },
        {
          level: 30,
          name: "invitation-db-test",
          method: "POST",
          path: "/api/organizations/:organizationId/invitations",
          status: 403,
          msg: "request completed",
        },
      ]);
      observed.push({ response, events });
    }
    const expectedResponse = {
      status: 403,
      body: {
        error: {
          code: "MEMBERSHIP_DENIED",
          message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
        },
      },
    };
    for (const attempt of observed) {
      expect(attempt.response).toEqual(expectedResponse);
      expect(attempt).toEqual(observed[0]);
    }
    expect((await rows()).some((row) => row.email === absentEmail)).toBe(false);
  });

  it("normalizes email, rejects members and live duplicate, ignores expired pending and records 48h expiry", async () => {
    const email = `normalize-${run}@example.test`;
    const before = Date.now();
    const attempts = mail.length;
    const first = await request("owner", orgA, `  ${email.toUpperCase()}  `);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ created: true, emailDispatch: "accepted" });
    expect(mail.length - attempts).toBe(1);
    expect(mail[attempts]?.to).toBe(email);
    expect((await rows()).filter((row) => row.email === email)).toHaveLength(1);
    const expiresAt = (await rows()).find(
      (row) => row.email === email,
    )?.expiresAt;
    expect(expiresAt?.getTime()).toBeGreaterThanOrEqual(
      before + 48 * 60 * 60 * 1000 - 1000,
    );
    expect(expiresAt?.getTime()).toBeLessThanOrEqual(
      Date.now() + 48 * 60 * 60 * 1000,
    );
    expect((await request("admin", orgA, email)).body).toMatchObject({
      error: { code: "INVITATION_ALREADY_PENDING" },
    });
    expect(
      (await request("owner", orgA, `OWNER-${run}@example.test`)).body,
    ).toMatchObject({ error: { code: "USER_ALREADY_MEMBER" } });
    expect(
      (await request("owner", orgA, `other-${run}@example.test`)).status,
    ).toBe(201);
    const otherMembership = await runtime.sql.query(
      "select 1 from member where organization_id = $1 and user_id = $2",
      [orgA, actorIds.other],
    );
    expect(otherMembership.rows).toEqual([]);
    const context = await app.request("/api/me/context", {
      headers: { "x-test-actor": "other" },
    });
    const protectedRead = await app.request(
      `/api/organizations/${orgA}/members`,
      {
        headers: { "x-test-actor": "other" },
      },
    );
    expect(protectedRead.status).toBe(403);
    expect(await protectedRead.json()).toEqual({
      error: {
        code: "MEMBERSHIP_DENIED",
        message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
      },
    });
    expect(context.status).toBe(200);
    expect(JSON.stringify(await context.json())).not.toContain(orgA);
    await owner.sql.query(
      "update invitation set expires_at = now() - interval '1 second' where organization_id = $1 and email = $2",
      [orgA, email],
    );
    expect((await request("owner", orgA, email)).status).toBe(201);
    expect((await rows()).filter((row) => row.email === email)).toHaveLength(2);
  });

  it("serializes concurrent duplicate requests and counts only live pending invitations up to 100", async () => {
    const email = `race-${run}@example.test`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => request("owner", orgA, email)),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      201, 409, 409, 409,
    ]);
    expect((await rows()).filter((row) => row.email === email)).toHaveLength(1);
    const existing = await runtime.sql.query<{ count: number }>(
      "select count(*)::int as count from invitation where organization_id = $1 and status = 'pending' and expires_at > now()",
      [orgA],
    );
    const remaining = 99 - (existing.rows[0]?.count ?? 0);
    await owner.sql.query(
      `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at)
       select gen_random_uuid()::text, $1, 'cap-' || n || $2, 'viewer', 'pending', $3, now() + interval '1 day'
       from generate_series(1, $4::int) n`,
      [orgA, `-${run}@example.test`, actorIds.owner, remaining],
    );
    const capped = await Promise.all([
      request("admin", orgA, `hundred-${run}@example.test`),
      request("owner", orgA, `hundred-one-${run}@example.test`),
    ]);
    expect(capped.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(capped.find((result) => result.status === 409)?.body).toMatchObject({
      error: { code: "INVITATION_LIMIT_REACHED" },
    });
    const count = await runtime.sql.query<{ count: number }>(
      "select count(*)::int as count from invitation where organization_id = $1 and status = 'pending' and expires_at > now()",
      [orgA],
    );
    expect(count.rows[0]?.count).toBe(100);
  });

  it("ignores invitations expiring during an organization lock wait and starts the 48h window after the wait", async () => {
    const holder = await runtime.sql.connect();
    const pending: ReturnType<typeof request>[] = [];
    let requestOutcomes = Promise.resolve<PromiseSettledResult<unknown>[]>([]);
    const requestPids = new Set<number>();
    const errors: unknown[] = [];
    const capture = (client: PoolClient) => {
      void client.query<{ pid: number }>("select pg_backend_pid() as pid").then(
        ({ rows }) => requestPids.add(rows[0]?.pid ?? -1),
        (error: unknown) => errors.push(error),
      );
    };
    const expiredEmail = `wait-expired-${run}@example.test`;
    const freshEmail = `wait-fresh-${run}@example.test`;
    try {
      const live = await owner.sql.query<{ count: number }>(
        "select count(*)::int as count from invitation where organization_id = $1 and status = 'pending' and expires_at > clock_timestamp()",
        [orgB],
      );
      const expiring = 100 - (live.rows[0]?.count ?? 0);
      expect(expiring).toBeGreaterThan(0);
      await owner.sql.query(
        `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at)
         select gen_random_uuid()::text, $1,
           case when n = 1 then $2 else 'wait-cap-' || n || $3 end,
           'viewer', 'pending', $4, clock_timestamp() + interval '2 seconds'
         from generate_series(1, $5::int) n`,
        [orgB, expiredEmail, `-${run}@example.test`, actorIds.both, expiring],
      );
      const {
        rows: [backend],
      } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
      runtime.sql.on("acquire", capture);
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for update",
        [orgB],
      );
      pending.push(request("both", orgB, expiredEmail));
      pending.push(request("both", orgB, freshEmail));
      requestOutcomes = Promise.allSettled(pending);
      await waitForInvitationLocks(backend?.pid ?? -1, requestPids, 2);
      const expiry = await owner.sql.query<{
        observedAt: Date;
        expiresAt: Date;
      }>(
        `select clock_timestamp() as "observedAt", expires_at as "expiresAt"
         from invitation where organization_id = $1 and email = $2`,
        [orgB, expiredEmail],
      );
      expect(expiry.rows[0]?.expiresAt.getTime()).toBeGreaterThan(
        expiry.rows[0]?.observedAt.getTime() ?? 0,
      );
      await holder.query("select pg_sleep(2.5)");
      const release = await holder.query<{ releasedAt: Date }>(
        'select clock_timestamp() as "releasedAt"',
      );
      expect(release.rows[0]?.releasedAt.getTime()).toBeGreaterThan(
        expiry.rows[0]?.expiresAt.getTime() ?? 0,
      );
      await holder.query("commit");
      const outcomes = await Promise.all(pending);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([201, 201]);
      const inserted = await owner.sql.query<{
        email: string;
        createdAt: Date;
        expiresAt: Date;
      }>(
        `select email, created_at as "createdAt", expires_at as "expiresAt"
         from invitation where organization_id = $1 and email = any($2::text[])
         and created_at >= $3 order by email`,
        [orgB, [expiredEmail, freshEmail], release.rows[0]?.releasedAt],
      );
      expect(inserted.rows.map((row) => row.email)).toEqual([
        expiredEmail,
        freshEmail,
      ]);
      for (const row of inserted.rows) {
        expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
          48 * 60 * 60 * 1000,
        );
      }
    } catch (error) {
      errors.push(error);
    } finally {
      runtime.sql.off("acquire", capture);
      const rollback = await Promise.allSettled([holder.query("rollback")]);
      holder.release(rollback[0].status === "rejected");
      for (const result of [...rollback, ...(await requestOutcomes)]) {
        if (result.status === "rejected") errors.push(result.reason);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Invitation race failed");
  }, 15_000);

  it("rechecks a downgraded actor after waiting for the organization lock", async () => {
    const holder = await runtime.sql.connect();
    const pending: ReturnType<typeof request>[] = [];
    let requestOutcomes = Promise.resolve<PromiseSettledResult<unknown>[]>([]);
    const requestPids = new Set<number>();
    const errors: unknown[] = [];
    const capture = (client: PoolClient) => {
      void client.query<{ pid: number }>("select pg_backend_pid() as pid").then(
        ({ rows }) => requestPids.add(rows[0]?.pid ?? -1),
        (error: unknown) => errors.push(error),
      );
    };
    try {
      const {
        rows: [backend],
      } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
      runtime.sql.on("acquire", capture);
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for update",
        [orgB],
      );
      const email = `downgraded-${run}@example.test`;
      pending.push(request("both", orgB, email));
      requestOutcomes = Promise.allSettled(pending);
      await waitForInvitationLocks(backend?.pid ?? -1, requestPids, 1);
      await owner.sql.query(
        "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
        [orgB, actorIds.both],
      );
      await holder.query("commit");
      expect(await pending[0]).toMatchObject({
        status: 403,
        body: { error: { code: "PERMISSION_DENIED" } },
      });
      expect((await rows(orgB)).some((row) => row.email === email)).toBe(false);
    } catch (error) {
      errors.push(error);
    } finally {
      runtime.sql.off("acquire", capture);
      const rollback = await Promise.allSettled([holder.query("rollback")]);
      holder.release(rollback[0].status === "rejected");
      for (const result of [...rollback, ...(await requestOutcomes)]) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      try {
        await owner.sql.query(
          "update member set role = 'admin' where organization_id = $1 and user_id = $2",
          [orgB, actorIds.both],
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Invitation race failed");
  });

  it("rechecks membership after a revoke while waiting for the organization lock", async () => {
    const holder = await runtime.sql.connect();
    const pending: ReturnType<typeof request>[] = [];
    let requestOutcomes = Promise.resolve<PromiseSettledResult<unknown>[]>([]);
    const requestPids = new Set<number>();
    const errors: unknown[] = [];
    const capture = (client: PoolClient) => {
      void client.query<{ pid: number }>("select pg_backend_pid() as pid").then(
        ({ rows }) => requestPids.add(rows[0]?.pid ?? -1),
        (error: unknown) => errors.push(error),
      );
    };
    try {
      const {
        rows: [backend],
      } = await holder.query<{ pid: number }>("select pg_backend_pid() as pid");
      runtime.sql.on("acquire", capture);
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for update",
        [orgB],
      );
      const email = `revoked-${run}@example.test`;
      pending.push(request("both", orgB, email));
      requestOutcomes = Promise.allSettled(pending);
      await waitForInvitationLocks(backend?.pid ?? -1, requestPids, 1);
      await owner.sql.query(
        "delete from member where organization_id = $1 and user_id = $2",
        [orgB, actorIds.both],
      );
      await holder.query("commit");
      expect(await pending[0]).toMatchObject({
        status: 403,
        body: { error: { code: "MEMBERSHIP_DENIED" } },
      });
      expect((await rows(orgB)).some((row) => row.email === email)).toBe(false);
    } catch (error) {
      errors.push(error);
    } finally {
      runtime.sql.off("acquire", capture);
      const rollback = await Promise.allSettled([holder.query("rollback")]);
      holder.release(rollback[0].status === "rejected");
      for (const result of [...rollback, ...(await requestOutcomes)]) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      try {
        await owner.sql.query(
          "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin') on conflict (organization_id, user_id) do nothing",
          [crypto.randomUUID(), orgB, actorIds.both],
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Invitation race failed");
  });

  it("denies native creation before the native auth handler while retaining the public preview", async () => {
    const native = await app.request("/api/auth/organization/invite-member", {
      method: "POST",
      headers: { "x-test-actor": "owner", "content-type": "application/json" },
      body: JSON.stringify({
        email: `native-${run}@example.test`,
        role: "viewer",
      }),
    });
    expect(native.status).toBe(403);
    expect(await native.json()).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    expect(
      (await rows()).some((row) => row.email === `native-${run}@example.test`),
    ).toBe(false);
    const preview = await app.request(
      "/api/onboarding/invitations/not-an-invitation",
    );
    expect(preview.status).toBe(404);
  });

  it("preserves a committed invitation on SMTP failure without exposing mail, token or target in logs", async () => {
    failMail = true;
    logs.length = 0;
    const email = `smtp-fail-${run}@example.test`;
    const before = mail.length;
    const response = await request("both", orgB, email);
    failMail = false;
    expect(response).toEqual({
      status: 201,
      body: { created: true, emailDispatch: "failed" },
    });
    expect(mail.length - before).toBe(1);
    expect((await rows(orgB)).some((row) => row.email === email)).toBe(true);
    const recorded = logs.join("\n");
    expect(recorded).not.toContain(email);
    expect(recorded).not.toContain(orgB);
    expect(recorded).not.toContain("accept-invitation/");
    expect(recorded).toContain(
      "/api/organizations/:organizationId/invitations",
    );
  });
});
