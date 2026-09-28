import { invitationCreateResponseSchema } from "@nightwatch/api-contract";
import { createDatabase, runMigrations } from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import type { Auth, AuthSession } from "../auth";
import type { Mailer, OutboundMail } from "../auth/mailer";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const runtime = createDatabase(runtimeUrl);
const owner = createDatabase(ownerUrl);
const run = crypto.randomUUID();
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const absentOrg = crypto.randomUUID();
const actorIds = Object.fromEntries(
  ["owner", "admin", "viewer", "auditor", "other", "both"].map((role) => [role, crypto.randomUUID()]),
) as Record<string, string>;
const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: runtimeUrl,
  BETTER_AUTH_SECRET: `invite-${run}`,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1", SMTP_PORT: 1025, SMTP_SECURE: false,
  SMTP_FROM: "Invitation <invite@example.test>",
};
const mail: OutboundMail[] = [];
let failMail = false;
const mailer: Mailer = {
  send: (message) => {
    mail.push(message);
    return failMail ? Promise.reject(new Error(`smtp ${message.to} ${message.text}`)) : Promise.resolve();
  },
  verify: () => Promise.resolve(),
};
const auth: Auth = {
  handler: () => Promise.resolve(new Response("native auth route not used")),
  getSession: (headers) => {
    const actor = headers.get("x-test-actor");
    const id = actor ? actorIds[actor] : undefined;
    return Promise.resolve(id ? {
      user: { id, email: `${actor}-${run}@example.test`, name: id, emailVerified: true },
      session: { id, token: "test-session", expiresAt: new Date(Date.now() + 60_000) },
    } satisfies AuthSession : null);
  },
};
const logs: string[] = [];
const app = createApp({
  env, authEnv, auth, database: runtime, mailer,
  logger: createLogger({ level: "info", name: "invitation-db-test" }, {
    write: (line: string) => { logs.push(line); },
  }),
});
const migrationsDir = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

async function request(actor: string, org: string, email: string, role = "viewer") {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-actor": actor },
    body: JSON.stringify({ email, role }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function rows(org = orgA) {
  return (await owner.sql.query<{ email: string; role: string; status: string; expiresAt: Date }>(
    `select email, role, status, expires_at as "expiresAt" from invitation where organization_id = $1`, [org],
  )).rows;
}

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'Invite A', $2), ($3, 'Invite B', $4)",
    [orgA, `invite-a-${run}`, orgB, `invite-b-${run}`],
  );
  for (const [role, id] of Object.entries(actorIds)) {
    await owner.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())`,
      [id, role, `${role}-${run}@example.test`],
    );
    if (role !== "other") await owner.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, $4)",
      [crypto.randomUUID(), orgA, id, role === "both" ? "owner" : role],
    );
  }
  await owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin')",
    [crypto.randomUUID(), orgB, actorIds.both],
  );
}, 120_000);

afterAll(async () => {
  await owner.sql.query("delete from organization where id = any($1::uuid[])", [[orgA, orgB]]);
  await owner.sql.query('delete from "user" where id = any($1::text[])', [Object.values(actorIds)]);
  await owner.close();
  await runtime.close();
});

describe("first-party invitation create", () => {
  it("enforces actor and invited role in the selected organization without probing absent organizations", async () => {
    for (const actor of ["owner", "admin", "viewer", "auditor", "other"]) {
      for (const role of ["owner", "admin", "viewer", "auditor"]) {
        const email = `${actor}-${role}-${run}@example.test`;
        const result = await request(actor, orgA, email, role);
        const permitted = actor === "owner" || actor === "admin" && role !== "owner";
        expect(result.status).toBe(permitted ? 201 : 403);
        if (permitted) expect(invitationCreateResponseSchema.parse(result.body)).toEqual({ created: true, emailDispatch: "accepted" });
        else expect(result.body).toMatchObject({ error: { code: actor === "other" ? "MEMBERSHIP_DENIED" : "PERMISSION_DENIED" } });
        expect((await rows()).some((row) => row.email === email)).toBe(permitted);
      }
    }
    expect(await request("owner", orgB, `cross-${run}@example.test`)).toEqual(
      await request("owner", absentOrg, `cross-${run}@example.test`),
    );
    expect((await request("both", orgB, `b-${run}@example.test`, "owner")).status).toBe(403);
    expect((await request("both", orgB, `b-${run}@example.test`, "auditor")).status).toBe(201);
    expect((await rows(orgB)).map((row) => row.role)).toEqual(["auditor"]);
    const invalid = await request("owner", orgA, `invalid-${run}`);
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_ERROR" } } });
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
      for (const privateValue of [orgA, absentOrg, existingEmail, absentEmail, run, "test-session", "accept-invitation/"]) {
        expect(captured).not.toContain(privateValue);
        expect(JSON.stringify(response)).not.toContain(privateValue);
      }
      const events = logs.map((line) => Object.fromEntries(
        Object.entries(JSON.parse(line) as Record<string, unknown>)
          .filter(([key]) => !["time", "pid", "hostname", "requestId", "durationMs"].includes(key)),
      ));
      expect(events).toEqual([
        {
          level: 40, name: "invitation-db-test", actorUserId: actorIds.other,
          action: "organization.invitation.create", code: "MEMBERSHIP_DENIED",
          msg: "organization access denied",
        },
        {
          level: 40, name: "invitation-db-test", code: "MEMBERSHIP_DENIED",
          msg: "request failed",
        },
        {
          level: 30, name: "invitation-db-test", method: "POST",
          path: "/api/organizations/:organizationId/invitations", status: 403,
          msg: "request completed",
        },
      ]);
      observed.push({ response, events });
    }
    const expectedResponse = {
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED", message: "คุณไม่ใช่สมาชิกขององค์กรนี้" } },
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
    const expiresAt = (await rows()).find((row) => row.email === email)?.expiresAt;
    expect(expiresAt?.getTime()).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000 - 1000);
    expect(expiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + 48 * 60 * 60 * 1000);
    expect((await request("admin", orgA, email)).body).toMatchObject({ error: { code: "INVITATION_ALREADY_PENDING" } });
    expect((await request("owner", orgA, `OWNER-${run}@example.test`)).body).toMatchObject({ error: { code: "USER_ALREADY_MEMBER" } });
    expect((await request("owner", orgA, `other-${run}@example.test`)).status).toBe(201);
    const otherMembership = await runtime.sql.query(
      "select 1 from member where organization_id = $1 and user_id = $2",
      [orgA, actorIds.other],
    );
    expect(otherMembership.rows).toEqual([]);
    const context = await app.request("/api/me/context", { headers: { "x-test-actor": "other" } });
    const protectedRead = await app.request(`/api/organizations/${orgA}/members`, {
      headers: { "x-test-actor": "other" },
    });
    expect(protectedRead.status).toBe(403);
    expect(await protectedRead.json()).toEqual({
      error: { code: "MEMBERSHIP_DENIED", message: "คุณไม่ใช่สมาชิกขององค์กรนี้" },
    });
    expect(context.status).toBe(200);
    expect(JSON.stringify(await context.json())).not.toContain(orgA);
    await owner.sql.query("update invitation set expires_at = now() - interval '1 second' where organization_id = $1 and email = $2", [orgA, email]);
    expect((await request("owner", orgA, email)).status).toBe(201);
    expect((await rows()).filter((row) => row.email === email)).toHaveLength(2);
  });

  it("serializes concurrent duplicate requests and counts only live pending invitations up to 100", async () => {
    const email = `race-${run}@example.test`;
    const results = await Promise.all(Array.from({ length: 4 }, () => request("owner", orgA, email)));
    expect(results.map((result) => result.status).sort()).toEqual([201, 409, 409, 409]);
    expect((await rows()).filter((row) => row.email === email)).toHaveLength(1);
    const existing = await runtime.sql.query<{ count: number }>(
      "select count(*)::int as count from invitation where organization_id = $1 and status = 'pending' and expires_at > now()", [orgA],
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

  it("rechecks a downgraded actor after waiting for the organization lock", async () => {
    const holder = await runtime.sql.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from organization where id = $1 for update", [orgB]);
      const email = `downgraded-${run}@example.test`;
      const pending = request("both", orgB, email);
      let waiting = false;
      for (let attempt = 0; attempt < 500 && !waiting; attempt += 1) {
        const activity = await owner.sql.query<{ waiting: boolean }>(
          `select exists (
             select 1 from pg_stat_activity where wait_event_type = 'Lock'
               and query like 'select name from organization where id = $1 for update%'
           ) as waiting`,
        );
        waiting = activity.rows[0]?.waiting ?? false;
      }
      expect(waiting).toBe(true);
      await owner.sql.query("update member set role = 'viewer' where organization_id = $1 and user_id = $2", [orgB, actorIds.both]);
      await holder.query("commit");
      expect(await pending).toMatchObject({ status: 403, body: { error: { code: "PERMISSION_DENIED" } } });
      expect((await rows(orgB)).some((row) => row.email === email)).toBe(false);
    } finally {
      await holder.query("rollback");
      holder.release();
      await owner.sql.query("update member set role = 'admin' where organization_id = $1 and user_id = $2", [orgB, actorIds.both]);
    }
  });

  it("rechecks membership after a revoke while waiting for the organization lock", async () => {
    const holder = await runtime.sql.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from organization where id = $1 for update", [orgB]);
      const email = `revoked-${run}@example.test`;
      const pending = request("both", orgB, email);
      let waiting = false;
      for (let attempt = 0; attempt < 500 && !waiting; attempt += 1) {
        const activity = await owner.sql.query<{ waiting: boolean }>(
          `select exists (
             select 1 from pg_stat_activity where wait_event_type = 'Lock'
               and query like 'select name from organization where id = $1 for update%'
           ) as waiting`,
        );
        waiting = activity.rows[0]?.waiting ?? false;
      }
      expect(waiting).toBe(true);
      await owner.sql.query("delete from member where organization_id = $1 and user_id = $2", [orgB, actorIds.both]);
      await holder.query("commit");
      expect(await pending).toMatchObject({ status: 403, body: { error: { code: "MEMBERSHIP_DENIED" } } });
      expect((await rows(orgB)).some((row) => row.email === email)).toBe(false);
    } finally {
      await holder.query("rollback");
      holder.release();
      await owner.sql.query(
        "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin') on conflict (organization_id, user_id) do nothing",
        [crypto.randomUUID(), orgB, actorIds.both],
      );
    }
  });

  it("denies native creation before the native auth handler while retaining the public preview", async () => {
    const native = await app.request("/api/auth/organization/invite-member", {
      method: "POST", headers: { "x-test-actor": "owner", "content-type": "application/json" },
      body: JSON.stringify({ email: `native-${run}@example.test`, role: "viewer" }),
    });
    expect(native.status).toBe(403);
    expect(await native.json()).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    expect((await rows()).some((row) => row.email === `native-${run}@example.test`)).toBe(false);
    const preview = await app.request("/api/onboarding/invitations/not-an-invitation");
    expect(preview.status).toBe(404);
  });

  it("preserves a committed invitation on SMTP failure without exposing mail, token or target in logs", async () => {
    failMail = true;
    logs.length = 0;
    const email = `smtp-fail-${run}@example.test`;
    const before = mail.length;
    const response = await request("both", orgB, email);
    failMail = false;
    expect(response).toEqual({ status: 201, body: { created: true, emailDispatch: "failed" } });
    expect(mail.length - before).toBe(1);
    expect((await rows(orgB)).some((row) => row.email === email)).toBe(true);
    const recorded = logs.join("\n");
    expect(recorded).not.toContain(email);
    expect(recorded).not.toContain(orgB);
    expect(recorded).not.toContain("accept-invitation/");
    expect(recorded).toContain("/api/organizations/:organizationId/invitations");
  });
});
