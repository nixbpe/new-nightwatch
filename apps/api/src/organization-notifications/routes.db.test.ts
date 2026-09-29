import { organizationMemberListResponseSchema } from "@nightwatch/api-contract";
import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { createAuth } from "../auth";
import type { Mailer, OutboundMail } from "../auth/mailer";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const run = crypto.randomUUID().slice(0, 8);
const organizationId = crypto.randomUUID();
const settingsOrganizationId = crypto.randomUUID();
const lastOwnerOrganizationId = crypto.randomUUID();
const inviterId = crypto.randomUUID();
const memberIds = {
  owner: crypto.randomUUID(),
  target: crypto.randomUUID(),
  leaver: crypto.randomUUID(),
  settingsOwner: crypto.randomUUID(),
  lastOwner: crypto.randomUUID(),
  homeowner: crypto.randomUUID(),
  secondOwner: crypto.randomUUID(),
};
const password = "Member-Route-Passw0rd!";
const appUrl = "http://localhost:5173";
const emails = {
  owner: `member-owner-${run}@example.test`,
  target: `member-target-${run}@example.test`,
  leaver: `member-leaver-${run}@example.test`,
  settingsOwner: `settings-owner-${run}@example.test`,
  lastOwner: `last-owner-${run}@example.test`,
  homeowner: `homeowner-${run}@example.test`,
  secondOwner: `second-owner-${run}@example.test`,
};
const userIds = new Map<keyof typeof emails, string>();
const mail: OutboundMail[] = [];
const runtime: Database = createDatabase(runtimeUrl);
const owner: Database = createDatabase(ownerUrl);
const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: runtimeUrl,
  BETTER_AUTH_SECRET: `member-route-${run}-0123456789abcdef`,
  APP_URL: appUrl,
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: appUrl,
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "Member routes <members@example.test>",
};
const mailer: Mailer = {
  send: (outbound) => {
    mail.push(outbound);
    return Promise.resolve();
  },
  verify: () => Promise.resolve(),
};
const auth = createAuth({
  env,
  authEnv,
  logger: createLogger({ level: "silent", name: "member-routes-db-test" }),
  database: runtime,
  mailer,
});
const auditLines: string[] = [];
const app = createApp({
  env,
  authEnv,
  auth,
  database: runtime,
  mailer,
  logger: createLogger(
    { level: "info", name: "member-routes-db-test" },
    { write: (line: string) => void auditLines.push(line) },
  ),
});

type ApiResponse = { status: number; json: unknown };
type Client = (
  method: "DELETE" | "GET" | "PATCH" | "POST",
  path: string,
  body?: Record<string, unknown>,
  options?: { invitationId?: string },
) => Promise<ApiResponse>;

function client(): Client {
  const cookies = new Map<string, string>();
  return async (method, path, body, options) => {
    const headers = new Headers();
    if (cookies.size > 0) {
      headers.set(
        "cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    if (body) {
      headers.set("content-type", "application/json");
      headers.set("origin", appUrl);
    }
    if (options?.invitationId)
      headers.set("x-invitation-id", options.invitationId);
    const response = await app.request(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      if (!pair) continue;
      const separator = pair.indexOf("=");
      if (separator === -1) continue;
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    return {
      status: response.status,
      json: text ? (JSON.parse(text) as unknown) : null,
    };
  };
}

function verificationToken(email: string): string {
  const message = mail.find(
    (entry) => entry.to === email && entry.subject.includes("ยืนยันอีเมล"),
  );
  if (!message) throw new Error(`verification mail missing for ${email}`);
  const token = new URL(
    /https?:\/\/[^\s<>'"]+/.exec(message.text)?.[0] ?? "",
  ).searchParams.get("emailVerificationToken");
  if (!token) throw new Error(`verification token missing for ${email}`);
  return token;
}

async function admit(member: keyof typeof emails): Promise<Client> {
  const request = client();
  const email = emails[member];
  const invitationId = crypto.randomUUID();
  await owner.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, 'viewer', 'pending', $4, now() + interval '1 day', now())`,
    [invitationId, organizationId, email, inviterId],
  );
  expect(
    (
      await request(
        "POST",
        "/api/auth/sign-up/email",
        {
          name: `Member ${member}`,
          email,
          password,
          callbackURL: `/onboarding?invitationId=${invitationId}`,
        },
        { invitationId },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        "GET",
        `/api/auth/verify-email?token=${encodeURIComponent(verificationToken(email))}`,
      )
    ).status,
  ).toBeLessThan(500);
  expect(
    (await request("POST", "/api/auth/sign-in/email", { email, password }))
      .status,
  ).toBe(200);
  const user = await owner.sql.query<{ id: string }>(
    'select id from "user" where email = $1',
    [email],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error(`admitted user missing for ${email}`);
  userIds.set(member, userId);
  return request;
}

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.sql.query(
    `insert into organization (id, name, slug, created_at)
     values ($1, $2, $3, now()),
            ($4, $5, $6, now()),
            ($7, $8, $9, now())`,
    [
      organizationId,
      `Member route ${run}`,
      `member-route-${run}`,
      settingsOrganizationId,
      `Settings route ${run}`,
      `settings-route-${run}`,
      lastOwnerOrganizationId,
      `Last owner route ${run}`,
      `last-owner-route-${run}`,
    ],
  );
  await owner.sql.query(
    'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
    [inviterId, "Member route inviter", `member-inviter-${run}@example.test`],
  );
}, 120_000);

afterAll(async () => {
  await owner.sql.query("delete from organization where id = any($1::uuid[])", [
    [organizationId, settingsOrganizationId, lastOwnerOrganizationId],
  ]);
  await owner.sql.query(
    'delete from "user" where id = $1 or email = any($2::text[])',
    [inviterId, Object.values(emails)],
  );
  await owner.close();
  await runtime.close();
});

describe("organization member HTTP mutations", () => {
  it("blocks stock Better Auth member mutations, preserves native password and MFA, and mutates membership through first-party routes", async () => {
    const ownerClient = await admit("owner");
    const targetClient = await admit("target");
    const leaverClient = await admit("leaver");
    const ownerId = userIds.get("owner");
    const targetId = userIds.get("target");
    const leaverId = userIds.get("leaver");
    if (!ownerId || !targetId || !leaverId)
      throw new Error("admitted membership users missing");

    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now()),
              ($4, $2, $5, 'viewer', now(), now()),
              ($6, $2, $7, 'viewer,auditor', now(), now())`,
      [
        memberIds.owner,
        organizationId,
        ownerId,
        memberIds.target,
        targetId,
        memberIds.leaver,
        leaverId,
      ],
    );
    await owner.sql.query(
      'update "user" set last_active_tenant_id = $1 where id = any($2::text[])',
      [organizationId, [targetId, leaverId]],
    );
    await owner.sql.query(
      "update session set active_organization_id = $1 where user_id = any($2::text[])",
      [organizationId, [targetId, leaverId]],
    );

    auditLines.length = 0;
    for (const path of [
      "/api/auth/organization/update-member-role",
      "/api/auth/organization/remove-member",
      "/api/auth/organization/leave",
      "/api/auth/organization/invite-member",
    ]) {
      const denied = await ownerClient("POST", path, {});
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual({
        error: {
          code: "PERMISSION_DENIED",
          message: "ใช้เส้นทางจัดการสมาชิกใหม่",
        },
      });
    }
    // Blocked native-path denials are audited with the actor too.
    expect(
      auditLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.msg === "organization access denied"),
    ).toEqual([
      expect.objectContaining({
        actorUserId: ownerId,
        action: "legacy:/api/auth/organization/update-member-role",
        code: "PERMISSION_DENIED",
      }),
      expect.objectContaining({
        action: "legacy:/api/auth/organization/remove-member",
      }),
      expect.objectContaining({
        action: "legacy:/api/auth/organization/leave",
      }),
      expect.objectContaining({
        action: "legacy:/api/auth/organization/invite-member",
      }),
    ]);

    auditLines.length = 0;
    const invitationEmail = `created-${run}@example.test`;
    const sentBefore = mail.length;
    const created = await ownerClient(
      "POST",
      `/api/organizations/${organizationId}/invitations`,
      { email: invitationEmail, role: "viewer" },
    );
    expect(created).toEqual({
      status: 201,
      json: { created: true, emailDispatch: "accepted" },
    });
    expect(mail.length - sentBefore).toBe(1);
    expect(mail[sentBefore]?.to).toBe(invitationEmail);
    expect(
      (
        await owner.sql.query(
          "select status from invitation where organization_id = $1 and email = $2",
          [organizationId, invitationEmail],
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);
    auditLines.length = 0;
    const list = await ownerClient(
      "GET",
      `/api/organizations/${organizationId}/members?limit=50&offset=0`,
    );
    expect(list.status).toBe(200);
    const listBody = organizationMemberListResponseSchema.parse(list.json);
    expect(listBody.organizationId).toBe(organizationId);
    expect(listBody.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: memberIds.owner, role: "owner" }),
      ]),
    );
    expect(listBody.page).toEqual({ limit: 50, offset: 0, total: 3 });
    const beyondSafeInteger = await ownerClient(
      "GET",
      `/api/organizations/${organizationId}/members?limit=50&offset=9007199254740991`,
    );
    expect(beyondSafeInteger.status).toBe(200);
    expect(
      organizationMemberListResponseSchema.parse(beyondSafeInteger.json),
    ).toMatchObject({
      members: [],
      page: { limit: 50, offset: Number.MAX_SAFE_INTEGER, total: 3 },
    });

    for (const clientForDeniedList of [targetClient, leaverClient]) {
      const deniedList = await clientForDeniedList(
        "GET",
        `/api/organizations/${organizationId}/members`,
      );
      expect(deniedList.status).toBe(403);
      expect(deniedList.json).toEqual({
        error: {
          code: "PERMISSION_DENIED",
          message: "คุณไม่มีสิทธิ์ดูรายชื่อสมาชิก",
        },
      });
    }
    for (const value of [
      "",
      " ",
      "0x32",
      "1e2",
      "1.5",
      "-1",
      "9007199254740992",
    ]) {
      const invalid = await ownerClient(
        "GET",
        `/api/organizations/${organizationId}/members?limit=${encodeURIComponent(value)}&offset=0`,
      );
      expect(invalid.status).toBe(400);
      expect(invalid.json).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
        },
      });
    }
    for (const offset of [
      "9007199254740992",
      "9223372036854775808",
      "1e2",
      "1.5",
    ]) {
      const invalid = await ownerClient(
        "GET",
        `/api/organizations/${organizationId}/members?limit=50&offset=${encodeURIComponent(offset)}`,
      );
      expect(invalid.status).toBe(400);
      expect(invalid.json).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
        },
      });
    }
    const missing = await leaverClient(
      "GET",
      `/api/organizations/${crypto.randomUUID()}/members`,
    );
    expect(missing.status).toBe(403);
    expect(missing.json).toEqual({
      error: {
        code: "MEMBERSHIP_DENIED",
        message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
      },
    });
    await owner.sql.query("update member set role = 'unknown' where id = $1", [
      memberIds.leaver,
    ]);
    const failure = await ownerClient(
      "GET",
      `/api/organizations/${organizationId}/members`,
    );
    expect(failure.status).toBe(500);
    expect(failure.json).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    await owner.sql.query(
      "update member set role = 'viewer,auditor' where id = $1",
      [memberIds.leaver],
    );
    await owner.sql.query("update member set role = 'unknown' where id = $1", [
      memberIds.owner,
    ]);
    const actorRoleFailure = await ownerClient(
      "GET",
      `/api/organizations/${organizationId}/members`,
    );
    expect(actorRoleFailure.status).toBe(500);
    expect(actorRoleFailure.json).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    await owner.sql.query("update member set role = 'owner' where id = $1", [
      memberIds.owner,
    ]);
    const logEntries = auditLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    const completionLogs = logEntries.filter(
      (entry) => entry.msg === "request completed",
    );
    expect(completionLogs).toHaveLength(18);
    for (const completion of completionLogs) {
      expect(completion.path).toBe(
        "/api/organizations/:organizationId/members",
      );
      expect(JSON.stringify(completion)).not.toContain(organizationId);
    }
    expect(JSON.stringify(logEntries)).not.toContain(organizationId);
    expect(JSON.stringify(logEntries)).not.toContain(memberIds.leaver);
    for (const audit of logEntries.filter(
      (entry) => entry.msg === "organization access denied",
    )) {
      const { action, actorUserId, code, ...metadata } = audit;
      expect(action).toBe("organization.member.list");
      expect(typeof actorUserId).toBe("string");
      expect(code).toMatch(/^(MEMBERSHIP|PERMISSION)_DENIED$/);
      expect(Object.keys(metadata).sort()).toEqual([
        "hostname",
        "level",
        "msg",
        "name",
        "pid",
        "time",
      ]);
    }

    expect(
      (
        await ownerClient("POST", "/api/auth/sign-in/email", {
          email: emails.owner,
          password,
        })
      ).status,
    ).toBe(200);
    expect(
      (await ownerClient("POST", "/api/auth/two-factor/enable", { password }))
        .status,
    ).toBe(200);

    // Denied PATCH responses and captured audit entries must not identify a
    // protected target, regardless of whether that target exists.
    auditLines.length = 0;
    const probes = [];
    for (const probedMemberId of [memberIds.owner, crypto.randomUUID()]) {
      probes.push(
        await targetClient(
          "PATCH",
          `/api/organizations/${organizationId}/members/${probedMemberId}/role`,
          { role: "viewer" },
        ),
      );
    }
    expect(probes[0]).toEqual(probes[1]);
    expect(probes[0]).toEqual({
      status: 403,
      json: {
        error: {
          code: "PERMISSION_DENIED",
          message: "คุณไม่มีสิทธิ์เปลี่ยนบทบาทสมาชิก",
        },
      },
    });
    const roleDenials = auditLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(
      roleDenials.filter((entry) => entry.msg === "organization access denied"),
    ).toEqual([
      expect.objectContaining({
        actorUserId: targetId,
        action: "organization.member.role.update",
        code: "PERMISSION_DENIED",
      }),
      expect.objectContaining({
        actorUserId: targetId,
        action: "organization.member.role.update",
        code: "PERMISSION_DENIED",
      }),
    ]);
    for (const line of auditLines) {
      for (const protectedValue of [
        organizationId,
        memberIds.owner,
        memberIds.target,
        emails.owner,
        emails.target,
        "Member owner",
        "Member target",
      ]) {
        expect(line).not.toContain(protectedValue);
      }
    }
    // Better Auth member IDs are opaque strings. The route must reach the
    // locked last-owner decision and update non-UUID targets as well.
    const opaqueOwnerId = `role-owner-${run}`;
    const opaqueTargetId = `role-target-${run}`;
    await owner.sql.query("update member set id = $2 where id = $1", [
      memberIds.owner,
      opaqueOwnerId,
    ]);
    await owner.sql.query("update member set id = $2 where id = $1", [
      memberIds.target,
      opaqueTargetId,
    ]);
    try {
      const lastOwnerRole = await ownerClient(
        "PATCH",
        `/api/organizations/${organizationId}/members/${opaqueOwnerId}/role`,
        { role: "viewer" },
      );
      expect(lastOwnerRole).toMatchObject({
        status: 400,
        json: { error: { code: "LAST_OWNER" } },
      });
      const opaqueUpdate = await ownerClient(
        "PATCH",
        `/api/organizations/${organizationId}/members/${opaqueTargetId}/role`,
        { role: "admin" },
      );
      expect(opaqueUpdate).toEqual({
        status: 200,
        json: {
          member: {
            id: opaqueTargetId,
            userId: targetId,
            organizationId,
            role: "admin",
          },
        },
      });
      expect(
        (
          await owner.sql.query<{ id: string; role: string }>(
            "select id, role from member where organization_id = $1 and id = any($2::text[]) order by id",
            [organizationId, [opaqueOwnerId, opaqueTargetId]],
          )
        ).rows,
      ).toEqual([
        { id: opaqueOwnerId, role: "owner" },
        { id: opaqueTargetId, role: "admin" },
      ]);
    } finally {
      await owner.sql.query("update member set id = $2 where id = $1", [
        opaqueOwnerId,
        memberIds.owner,
      ]);
      await owner.sql.query(
        "update member set id = $2, role = 'viewer' where id = $1",
        [opaqueTargetId, memberIds.target],
      );
    }

    const role = await ownerClient(
      "PATCH",
      `/api/organizations/${organizationId}/members/${memberIds.target}/role`,
      { role: "admin" },
    );
    expect(role.status).toBe(200);
    expect(role.json).toMatchObject({
      member: { id: memberIds.target, userId: targetId, role: "admin" },
    });
    expect(
      (
        await owner.sql.query<{ role: string }>(
          "select role from member where id = $1",
          [memberIds.target],
        )
      ).rows[0]?.role,
    ).toBe("admin");

    auditLines.length = 0;
    const adminOwnerProbe = await targetClient(
      "PATCH",
      `/api/organizations/${organizationId}/members/${memberIds.owner}/role`,
      { role: "viewer" },
    );
    const adminMissingProbe = await targetClient(
      "PATCH",
      `/api/organizations/${organizationId}/members/${crypto.randomUUID()}/role`,
      { role: "viewer" },
    );
    expect(adminOwnerProbe).toEqual(adminMissingProbe);
    expect(adminOwnerProbe).toEqual({
      status: 403,
      json: {
        error: {
          code: "PERMISSION_DENIED",
          message: "เฉพาะเจ้าขององค์กรเท่านั้นที่เปลี่ยนเจ้าของได้",
        },
      },
    });
    for (const line of auditLines) {
      for (const protectedValue of [
        organizationId,
        memberIds.owner,
        emails.owner,
        emails.target,
        "Member owner",
        "Member target",
      ]) {
        expect(line).not.toContain(protectedValue);
      }
    }

    // Composite stored roles are projected to one contract role.
    await owner.sql.query(
      "update member set role = 'admin,viewer' where id = $1",
      [memberIds.target],
    );
    const revoke = await ownerClient(
      "DELETE",
      `/api/organizations/${organizationId}/members/${memberIds.target}`,
    );
    expect(revoke.status).toBe(200);
    expect(revoke.json).toMatchObject({
      member: { id: memberIds.target, userId: targetId, role: "admin" },
    });
    expect(
      (
        await owner.sql.query<{ last_active_tenant_id: string | null }>(
          'select last_active_tenant_id from "user" where id = $1',
          [targetId],
        )
      ).rows[0]?.last_active_tenant_id,
    ).toBeNull();
    expect(
      (
        await owner.sql.query<{ active_organization_id: string | null }>(
          "select active_organization_id from session where user_id = $1",
          [targetId],
        )
      ).rows.every((session) => session.active_organization_id === null),
    ).toBe(true);

    const revokedList = await targetClient(
      "GET",
      `/api/organizations/${organizationId}/members`,
    );
    expect(revokedList).toEqual({
      status: 403,
      json: {
        error: {
          code: "MEMBERSHIP_DENIED",
          message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
        },
      },
    });
    const revokedContext = await targetClient("GET", "/api/me/context");
    expect(revokedContext.status).toBe(200);
    expect(revokedContext.json).toMatchObject({
      organizations: [],
      lastActiveTenantId: null,
    });

    const leave = await leaverClient(
      "DELETE",
      `/api/organizations/${organizationId}/members/me`,
    );
    expect(leave.json).toMatchObject({
      member: { id: memberIds.leaver, userId: leaverId, role: "viewer" },
    });
    expect(leave.status).toBe(200);
    expect(
      (
        await owner.sql.query<{ last_active_tenant_id: string | null }>(
          'select last_active_tenant_id from "user" where id = $1',
          [leaverId],
        )
      ).rows[0]?.last_active_tenant_id,
    ).toBeNull();
    expect(
      (
        await owner.sql.query<{ active_organization_id: string | null }>(
          "select active_organization_id from session where user_id = $1",
          [leaverId],
        )
      ).rows.every((session) => session.active_organization_id === null),
    ).toBe(true);

    // A nonmember gets one denial whether or not the organization exists,
    // and every denial is audited with the actor but no tenant data.
    auditLines.length = 0;
    for (const probedOrganizationId of [organizationId, crypto.randomUUID()]) {
      const probe = await leaverClient(
        "DELETE",
        `/api/organizations/${probedOrganizationId}/members/me`,
      );
      expect(probe.status).toBe(403);
      expect(probe.json).toMatchObject({
        error: { code: "MEMBERSHIP_DENIED" },
      });
    }
    // Membership is resolved before any tenant context or organization lock:
    // a nonmember is denied even while another transaction holds the row.
    const lockHolder = await owner.sql.connect();
    try {
      await lockHolder.query("begin");
      await lockHolder.query(
        "select id from organization where id = $1 for update",
        [organizationId],
      );
      const blocked = await leaverClient(
        "DELETE",
        `/api/organizations/${organizationId}/members/me`,
      );
      expect(blocked.status).toBe(403);
      const blockedSwitch = await leaverClient("PATCH", "/api/me/active-org", {
        organizationId,
      });
      expect(blockedSwitch.status).toBe(403);
      expect(blockedSwitch.json).toMatchObject({
        error: { code: "MEMBERSHIP_DENIED" },
      });
    } finally {
      await lockHolder.query("rollback");
      lockHolder.release();
    }

    const denials = auditLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "organization access denied");
    expect(denials).toHaveLength(3);
    for (const denial of denials) {
      expect(denial).toMatchObject({
        actorUserId: leaverId,
        action: "organization.member.leave",
        code: "MEMBERSHIP_DENIED",
      });
      expect(JSON.stringify(denial)).not.toContain(organizationId);
    }

    const lastOwner = await ownerClient(
      "DELETE",
      `/api/organizations/${organizationId}/members/me`,
    );
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.json).toMatchObject({ error: { code: "LAST_OWNER" } });
    expect(
      (
        await owner.sql.query("select 1 from member where id = $1", [
          memberIds.owner,
        ])
      ).rows,
    ).toHaveLength(1);

    // Keep the target client live until all mutations complete: its session was
    // a real Better Auth session whose active-org mirror was cleared by revoke.
    expect((await targetClient("GET", "/api/auth/get-session")).status).toBe(
      200,
    );
  }, 120_000);
});

describe("organization member last-owner HTTP protection", () => {
  it("counts only exact owner tokens when preserving the last owner", async () => {
    const lastOwnerClient = await admit("lastOwner");
    const homeownerClient = await admit("homeowner");
    await admit("secondOwner");
    const lastOwnerId = userIds.get("lastOwner");
    const homeownerId = userIds.get("homeowner");
    const secondOwnerId = userIds.get("secondOwner");
    if (!lastOwnerId || !homeownerId || !secondOwnerId) {
      throw new Error("last-owner membership users missing");
    }

    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner,viewer', now(), now()),
              ($4, $2, $5, 'homeowner', now(), now())`,
      [
        memberIds.lastOwner,
        lastOwnerOrganizationId,
        lastOwnerId,
        memberIds.homeowner,
        homeownerId,
      ],
    );

    const counts = async () => {
      const result = await owner.sql.query<{
        memberCount: number;
        lastActiveMirrorCount: number;
        activeSessionMirrorCount: number;
        intentCount: number;
        ledgerCount: number;
      }>(
        `select
           (select count(*)::int from member where organization_id = $1::uuid) as "memberCount",
           (select count(*)::int from "user" where last_active_tenant_id = $1::uuid) as "lastActiveMirrorCount",
           (select count(*)::int from session where active_organization_id = $1::text) as "activeSessionMirrorCount",
           (select count(*)::int from notification_intents where tenant_id = $1::uuid) as "intentCount",
           (select count(*)::int
            from notification_dispatch_ledger as ledger
            join notification_intents as intent on intent.id = ledger.intent_id
            where intent.tenant_id = $1::uuid) as "ledgerCount"`,
        [lastOwnerOrganizationId],
      );
      const count = result.rows[0];
      if (!count) throw new Error("last-owner counts missing");
      return count;
    };
    const before = await counts();

    const substringActor = await homeownerClient(
      "PATCH",
      `/api/organizations/${lastOwnerOrganizationId}/members/${memberIds.lastOwner}/role`,
      { role: "viewer" },
    );
    expect(substringActor.status).toBe(403);
    expect(substringActor.json).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });

    for (const response of [
      await lastOwnerClient(
        "PATCH",
        `/api/organizations/${lastOwnerOrganizationId}/members/${memberIds.lastOwner}/role`,
        { role: "viewer" },
      ),
      await lastOwnerClient(
        "DELETE",
        `/api/organizations/${lastOwnerOrganizationId}/members/${memberIds.lastOwner}`,
      ),
      await lastOwnerClient(
        "DELETE",
        `/api/organizations/${lastOwnerOrganizationId}/members/me`,
      ),
    ]) {
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({ error: { code: "LAST_OWNER" } });
    }

    expect(await counts()).toEqual(before);
    expect(
      (
        await owner.sql.query<{ role: string }>(
          "select role from member where id = $1",
          [memberIds.lastOwner],
        )
      ).rows[0]?.role,
    ).toBe("owner,viewer");

    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner,viewer', now(), now())`,
      [memberIds.secondOwner, lastOwnerOrganizationId, secondOwnerId],
    );
    const transfer = await lastOwnerClient(
      "PATCH",
      `/api/organizations/${lastOwnerOrganizationId}/members/${memberIds.lastOwner}/role`,
      { role: "viewer" },
    );
    expect(transfer.status).toBe(200);
    expect(transfer.json).toMatchObject({
      member: { id: memberIds.lastOwner, userId: lastOwnerId, role: "viewer" },
    });
    expect(
      (
        await owner.sql.query<{ role: string }>(
          "select role from member where id = $1",
          [memberIds.secondOwner],
        )
      ).rows[0]?.role,
    ).toBe("owner,viewer");
    expect(await counts()).toEqual({ ...before, memberCount: 3 });
  }, 120_000);
});

describe("organization notification settings HTTP input validation", () => {
  it("returns INVALID_INPUT for malformed settings request input while preserving authorized behavior and unauthenticated privacy", async () => {
    const settingsOwnerClient = await admit("settingsOwner");
    const settingsOwnerId = userIds.get("settingsOwner");
    if (!settingsOwnerId) throw new Error("admitted settings owner missing");
    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now())`,
      [memberIds.settingsOwner, settingsOrganizationId, settingsOwnerId],
    );

    const invalidOrganizationId = "not-a-uuid";
    for (const [method, path, body] of [
      [
        "GET",
        `/api/organizations/${invalidOrganizationId}/notification-settings`,
        undefined,
      ],
      [
        "PATCH",
        `/api/organizations/${invalidOrganizationId}/notification-settings`,
        { settingsChangedEnabled: false, expectedVersion: 0 },
      ],
      [
        "PATCH",
        `/api/organizations/${settingsOrganizationId}/notification-settings`,
        { settingsChangedEnabled: "false", expectedVersion: 0 },
      ],
      [
        "PATCH",
        `/api/organizations/${settingsOrganizationId}/notification-settings`,
        { settingsChangedEnabled: false, expectedVersion: 0.5 },
      ],
      [
        "PATCH",
        `/api/organizations/${settingsOrganizationId}/notification-settings`,
        undefined,
      ],
    ] as const) {
      const response = await settingsOwnerClient(method, path, body);
      expect(response.status).toBe(400);
      expect(response.json).toEqual({
        error: { code: "INVALID_INPUT", message: "Invalid request input" },
      });
    }

    const initial = await settingsOwnerClient(
      "GET",
      `/api/organizations/${settingsOrganizationId}/notification-settings`,
    );
    expect(initial.status).toBe(200);
    expect(initial.json).toEqual({
      organizationId: settingsOrganizationId,
      settingsChangedEnabled: true,
      version: 0,
    });

    const updated = await settingsOwnerClient(
      "PATCH",
      `/api/organizations/${settingsOrganizationId}/notification-settings`,
      { settingsChangedEnabled: false, expectedVersion: 0 },
    );
    expect(updated.status).toBe(200);
    expect(updated.json).toEqual({
      organizationId: settingsOrganizationId,
      settingsChangedEnabled: false,
      version: 1,
    });

    const unauthenticated = await client()(
      "GET",
      `/api/organizations/${settingsOrganizationId}/notification-settings`,
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.json).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  }, 120_000);
});
