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
const roleOrganizationId = crypto.randomUUID();
const revokeOrganizationId = crypto.randomUUID();
const revokeOtherOrganizationId = crypto.randomUUID();
const leaveOrganizationId = crypto.randomUUID();
const leaveOtherOrganizationId = crypto.randomUUID();
const nativeOrganizationId = crypto.randomUUID();
const inviterId = crypto.randomUUID();
const memberIds = {
  owner: crypto.randomUUID(),
  target: crypto.randomUUID(),
  leaver: crypto.randomUUID(),
  settingsOwner: crypto.randomUUID(),
  monitorOwner: crypto.randomUUID(),
  settingsAdmin: crypto.randomUUID(),
  settingsViewer: crypto.randomUUID(),
  lastOwner: crypto.randomUUID(),
  homeowner: crypto.randomUUID(),
  secondOwner: crypto.randomUUID(),
  roleOwner: `opaque-owner-${run}`,
  roleAdmin: `opaque-admin-${run}`,
  roleViewer: `opaque-viewer-${run}`,
  revokeOwner: crypto.randomUUID(),
  revokeAdmin: crypto.randomUUID(),
  revokeTarget: crypto.randomUUID(),
  revokeTargetB: crypto.randomUUID(),
};
const leaveRoles = ["owner", "admin", "viewer", "auditor"] as const;
const password = "Member-Route-Passw0rd!";
const appUrl = "http://localhost:5173";
const emails = {
  owner: `member-owner-${run}@example.test`,
  target: `member-target-${run}@example.test`,
  leaver: `member-leaver-${run}@example.test`,
  settingsOwner: `settings-owner-${run}@example.test`,
  monitorOwner: `monitor-owner-${run}@example.test`,
  settingsAdmin: `settings-admin-${run}@example.test`,
  settingsViewer: `settings-viewer-${run}@example.test`,
  lastOwner: `last-owner-${run}@example.test`,
  homeowner: `homeowner-${run}@example.test`,
  secondOwner: `second-owner-${run}@example.test`,
  roleOwner: `role-owner-${run}@example.test`,
  roleAdmin: `role-admin-${run}@example.test`,
  roleViewer: `role-viewer-${run}@example.test`,
  revokeOwner: `revoke-owner-${run}@example.test`,
  revokeAdmin: `revoke-admin-${run}@example.test`,
  revokeTarget: `revoke-target-${run}@example.test`,
  leaveOwner: `leave-owner-${run}@example.test`,
  leaveOwner2: `leave-owner2-${run}@example.test`,
  leaveAdmin: `leave-admin-${run}@example.test`,
  leaveViewer: `leave-viewer-${run}@example.test`,
  leaveAuditor: `leave-auditor-${run}@example.test`,
  nativeOwner: `native-owner-${run}@example.test`,
  nativeAdmin: `native-admin-${run}@example.test`,
  nativeViewer: `native-viewer-${run}@example.test`,
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

async function admit(
  member: keyof typeof emails,
  admitOrganizationId = organizationId,
): Promise<Client> {
  const request = client();
  const email = emails[member];
  const invitationId = crypto.randomUUID();
  await owner.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, 'viewer', 'pending', $4, now() + interval '1 day', now())`,
    [invitationId, admitOrganizationId, email, inviterId],
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
            ($7, $8, $9, now()),
            ($10, $11, $12, now()),
            ($13, $14, $15, now()),
            ($16, $17, $18, now()),
            ($19, $20, $21, now()),
            ($22, $23, $24, now()),
            ($25, $26, $27, now())`,
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
      roleOrganizationId,
      `Role route ${run}`,
      `role-route-${run}`,
      revokeOrganizationId,
      `Revoke route A ${run}`,
      `revoke-route-a-${run}`,
      revokeOtherOrganizationId,
      `Revoke route B ${run}`,
      `revoke-route-b-${run}`,
      leaveOrganizationId,
      `Leave route A ${run}`,
      `leave-route-a-${run}`,
      leaveOtherOrganizationId,
      `Leave route B ${run}`,
      `leave-route-b-${run}`,
      nativeOrganizationId,
      `Native route ${run}`,
      `native-route-${run}`,
    ],
  );
  await owner.sql.query(
    'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
    [inviterId, "Member route inviter", `member-inviter-${run}@example.test`],
  );
}, 120_000);

afterAll(async () => {
  await owner.sql.query("delete from organization where id = any($1::uuid[])", [
    [
      organizationId,
      settingsOrganizationId,
      lastOwnerOrganizationId,
      roleOrganizationId,
      revokeOrganizationId,
      revokeOtherOrganizationId,
      leaveOrganizationId,
      leaveOtherOrganizationId,
      nativeOrganizationId,
    ],
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

    // An unauthorized actor is denied before any target lookup, so a missing
    // and an existing target are indistinguishable to a viewer.
    for (const probedMemberId of [memberIds.owner, crypto.randomUUID()]) {
      const probe = await targetClient(
        "PATCH",
        `/api/organizations/${organizationId}/members/${probedMemberId}/role`,
        { role: "viewer" },
      );
      expect(probe.status).toBe(403);
      expect(probe.json).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
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

describe("organization member role HTTP contract", () => {
  it("accepts opaque member IDs, gives an admin identical denials for owner and absent targets, and redacts logs", async () => {
    const ownerClient = await admit("roleOwner");
    const adminClient = await admit("roleAdmin");
    const viewerClient = await admit("roleViewer");
    const ids = {
      owner: userIds.get("roleOwner"),
      admin: userIds.get("roleAdmin"),
      viewer: userIds.get("roleViewer"),
    };
    if (!ids.owner || !ids.admin || !ids.viewer)
      throw new Error("role membership users missing");
    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $4, $5, 'owner', now(), now()),
              ($2, $4, $6, 'admin', now(), now()),
              ($3, $4, $7, 'viewer', now(), now())`,
      [
        memberIds.roleOwner,
        memberIds.roleAdmin,
        memberIds.roleViewer,
        roleOrganizationId,
        ids.owner,
        ids.admin,
        ids.viewer,
      ],
    );
    const path = (memberId: string) =>
      `/api/organizations/${roleOrganizationId}/members/${memberId}/role`;

    auditLines.length = 0;
    const changed = await ownerClient("PATCH", path(memberIds.roleViewer), {
      role: "auditor",
    });
    expect(changed).toEqual({
      status: 200,
      json: {
        member: {
          id: memberIds.roleViewer,
          userId: ids.viewer,
          organizationId: roleOrganizationId,
          role: "auditor",
        },
      },
    });

    const adminSaves = await adminClient("PATCH", path(memberIds.roleViewer), {
      role: "viewer",
    });
    expect(adminSaves.status).toBe(200);

    const ownerTarget = await adminClient("PATCH", path(memberIds.roleOwner), {
      role: "viewer",
    });
    const absentTarget = await adminClient("PATCH", path(`absent-${run}`), {
      role: "viewer",
    });
    const ownerGrant = await adminClient("PATCH", path(memberIds.roleViewer), {
      role: "owner",
    });
    expect(ownerTarget.status).toBe(403);
    expect(ownerTarget.json).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    expect(absentTarget).toEqual(ownerTarget);
    expect(ownerGrant).toEqual(ownerTarget);
    // A viewer gets the same full response for an existing and a missing target.
    const viewerExisting = await viewerClient(
      "PATCH",
      path(memberIds.roleOwner),
      { role: "viewer" },
    );
    const viewerMissing = await viewerClient("PATCH", path(`absent-${run}`), {
      role: "viewer",
    });
    expect(viewerExisting.status).toBe(403);
    expect(viewerMissing).toEqual(viewerExisting);
    // An owner learns that a target is absent.
    const ownerAbsent = await ownerClient("PATCH", path(`absent-${run}`), {
      role: "viewer",
    });
    expect(ownerAbsent.status).toBe(404);
    expect(ownerAbsent.json).toMatchObject({
      error: { code: "MEMBER_NOT_FOUND" },
    });
    expect(
      (
        await owner.sql.query<{ role: string }>(
          "select role from member where id = any($1::text[]) order by id",
          [[memberIds.roleOwner, memberIds.roleViewer]],
        )
      ).rows.map((row) => row.role),
    ).toEqual(["owner", "viewer"].sort());

    for (const [body, memberId] of [
      [{ role: "root" }, memberIds.roleViewer],
      [{}, memberIds.roleViewer],
    ] as const) {
      const invalid = await ownerClient("PATCH", path(memberId), body);
      expect(invalid).toEqual({
        status: 400,
        json: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
          },
        },
      });
    }

    const logEntries = auditLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    const serialized = JSON.stringify(logEntries);
    for (const secret of [
      roleOrganizationId,
      memberIds.roleOwner,
      memberIds.roleViewer,
      `absent-${run}`,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    const denials = logEntries.filter(
      (entry) => entry.msg === "organization access denied",
    );
    expect(denials.map((denial) => denial.actorUserId)).toEqual([
      ids.admin,
      ids.admin,
      ids.admin,
      ids.viewer,
      ids.viewer,
    ]);
    for (const denial of denials) {
      expect(denial).toMatchObject({
        action: "organization.member.role.update",
        code: "PERMISSION_DENIED",
      });
    }
    for (const completion of logEntries.filter(
      (entry) => entry.msg === "request completed",
    )) {
      expect(completion.path).toBe(
        "/api/organizations/:organizationId/members/:memberId/role",
      );
    }
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
      monitorAlertsEnabled: true,
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
      monitorAlertsEnabled: true,
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

describe("organization monitor alerts setting HTTP contract", () => {
  it("edits monitorAlertsEnabled as owner or admin with audit, CAS and settings-changed rules", async () => {
    const settingsPath = `/api/organizations/${settingsOrganizationId}/notification-settings`;
    const ownerClient = await admit("monitorOwner");
    const adminClient = await admit("settingsAdmin");
    const viewerClient = await admit("settingsViewer");
    const ownerId = userIds.get("monitorOwner") as string;
    for (const [key, role] of [
      ["monitorOwner", "owner"],
      ["settingsAdmin", "viewer,admin"],
      ["settingsViewer", "viewer"],
    ] as const) {
      await owner.sql.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [memberIds[key], settingsOrganizationId, userIds.get(key), role],
      );
    }
    // The audit event is written in the mutation's transaction (F-007).
    const alertAudits = async () =>
      (
        await owner.sql.query<{
          actorUserId: string;
          actorRole: string;
          changes: unknown;
        }>(
          `select actor_user_id as "actorUserId", actor_role as "actorRole", changes
           from audit_events
           where tenant_id = $1
             and action = 'organization.notification-settings.monitor-alerts.update'
           order by occurred_at, id`,
          [settingsOrganizationId],
        )
      ).rows;
    const changedIntents = async () =>
      (
        await owner.sql.query(
          `select 1 from notification_intents
           where tenant_id = $1 and event_type = 'ORG-NOTIFICATION-SETTINGS-CHANGED'`,
          [settingsOrganizationId],
        )
      ).rowCount;
    const current = async () =>
      (await ownerClient("GET", settingsPath)).json as {
        settingsChangedEnabled: boolean;
        monitorAlertsEnabled: boolean;
        version: number;
      };

    // settingsChangedEnabled only: the previous client contract keeps working.
    let state = await current();
    const legacy = await ownerClient("PATCH", settingsPath, {
      settingsChangedEnabled: true,
      expectedVersion: state.version,
    });
    expect(legacy.status).toBe(200);
    expect(legacy.json).toMatchObject({
      settingsChangedEnabled: true,
      monitorAlertsEnabled: true,
    });
    expect(await alertAudits()).toHaveLength(0);

    // At least one toggle is required.
    state = await current();
    const empty = await ownerClient("PATCH", settingsPath, {
      expectedVersion: state.version,
    });
    expect(empty.status).toBe(400);
    expect(empty.json).toMatchObject({ error: { code: "INVALID_INPUT" } });

    // Owner changes only the monitor toggle: settings-changed rule applies, audit line follows.
    const intentsBefore = await changedIntents();
    const changed = await ownerClient("PATCH", settingsPath, {
      monitorAlertsEnabled: false,
      expectedVersion: state.version,
    });
    expect(changed.status).toBe(200);
    expect(changed.json).toEqual({
      organizationId: settingsOrganizationId,
      settingsChangedEnabled: true,
      monitorAlertsEnabled: false,
      version: state.version + 1,
    });
    expect(await changedIntents()).toBe((intentsBefore ?? 0) + 1);
    const alertEvents = await alertAudits();
    expect(alertEvents).toHaveLength(1);
    expect(alertEvents[0]).toMatchObject({
      actorUserId: ownerId,
      actorRole: "owner",
      changes: [
        {
          field: "monitorAlertsEnabled",
          before: { kind: "value", value: true },
          after: { kind: "value", value: false },
        },
      ],
    });

    // Stale version: 409, no write, no audit.
    const conflict = await ownerClient("PATCH", settingsPath, {
      monitorAlertsEnabled: true,
      expectedVersion: state.version,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json).toMatchObject({
      error: { code: "SETTINGS_VERSION_CONFLICT" },
    });

    // Viewer: 403, no write, no audit.
    state = await current();
    const denied = await viewerClient("PATCH", settingsPath, {
      monitorAlertsEnabled: true,
      expectedVersion: state.version,
    });
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    expect(await current()).toEqual(state);

    // Same value: no version bump and no audit.
    const noop = await ownerClient("PATCH", settingsPath, {
      monitorAlertsEnabled: false,
      expectedVersion: state.version,
    });
    expect(noop.status).toBe(200);
    expect(noop.json).toMatchObject({ version: state.version });
    expect(await alertAudits()).toHaveLength(1);

    // Admin may edit it back; second audit line names the admin.
    const restored = await adminClient("PATCH", settingsPath, {
      monitorAlertsEnabled: true,
      expectedVersion: state.version,
    });
    expect(restored.status).toBe(200);
    expect(restored.json).toMatchObject({ monitorAlertsEnabled: true });
    const afterRestore = await alertAudits();
    expect(afterRestore).toHaveLength(2);
    expect(afterRestore[1]).toMatchObject({
      actorUserId: userIds.get("settingsAdmin"),
      actorRole: "admin",
    });
  }, 180_000);
});

describe("organization member revoke HTTP contract", () => {
  it("denies the revoked session's next A request, keeps B in context and reports denials without leaking targets", async () => {
    const ownerClient = await admit("revokeOwner");
    const adminClient = await admit("revokeAdmin");
    const targetSession1 = await admit("revokeTarget");
    const ids = {
      owner: userIds.get("revokeOwner"),
      admin: userIds.get("revokeAdmin"),
      target: userIds.get("revokeTarget"),
    };
    if (!ids.owner || !ids.admin || !ids.target)
      throw new Error("revoke membership users missing");
    const a = revokeOrganizationId;
    const b = revokeOtherOrganizationId;
    await owner.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $5, $6, 'owner', now(), now()),
              ($2, $5, $7, 'admin', now(), now()),
              ($3, $5, $8, 'admin', now(), now()),
              ($4, $9, $8, 'viewer', now(), now())`,
      [
        memberIds.revokeOwner,
        memberIds.revokeAdmin,
        memberIds.revokeTarget,
        memberIds.revokeTargetB,
        a,
        ids.owner,
        ids.admin,
        ids.target,
        b,
      ],
    );
    // Second session of the same user, signed in independently.
    const targetSession2 = client();
    expect(
      (
        await targetSession2("POST", "/api/auth/sign-in/email", {
          email: emails.revokeTarget,
          password,
        })
      ).status,
    ).toBe(200);
    for (const session of [targetSession1, targetSession2]) {
      expect(
        (await session("PATCH", "/api/me/active-org", { organizationId: a }))
          .status,
      ).toBe(200);
      expect(
        (await session("GET", `/api/organizations/${a}/members`)).status,
      ).toBe(200);
    }
    const mirrors = () =>
      owner.sql
        .query<{ active_organization_id: string | null }>(
          "select active_organization_id from session where user_id = $1 order by created_at, id",
          [ids.target],
        )
        .then((result) => result.rows.map((row) => row.active_organization_id));
    expect(await mirrors()).toEqual([a, a]);

    // An admin gets identical denials for an owner target and an absent one.
    auditLines.length = 0;
    const adminOwnerTarget = await adminClient(
      "DELETE",
      `/api/organizations/${a}/members/${memberIds.revokeOwner}`,
    );
    const absentId = `absent-${run}`;
    const adminAbsentTarget = await adminClient(
      "DELETE",
      `/api/organizations/${a}/members/${absentId}`,
    );
    expect(adminOwnerTarget.status).toBe(403);
    expect(adminOwnerTarget.json).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    expect(adminAbsentTarget).toEqual(adminOwnerTarget);
    // The owner learns that a target is absent, not a denial.
    const ownerAbsent = await ownerClient(
      "DELETE",
      `/api/organizations/${a}/members/${absentId}`,
    );
    expect(ownerAbsent.status).toBe(404);
    expect(ownerAbsent.json).toMatchObject({
      error: { code: "MEMBER_NOT_FOUND" },
    });
    // The sole owner cannot revoke itself.
    const lastOwner = await ownerClient(
      "DELETE",
      `/api/organizations/${a}/members/${memberIds.revokeOwner}`,
    );
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.json).toMatchObject({ error: { code: "LAST_OWNER" } });
    const serialized = auditLines.join("\n");
    for (const secret of [
      a,
      memberIds.revokeOwner,
      memberIds.revokeTarget,
      absentId,
      emails.revokeOwner,
      emails.revokeTarget,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(
      (
        await owner.sql.query(
          "select 1 from member where organization_id = $1",
          [a],
        )
      ).rows,
    ).toHaveLength(3);

    // The owner revokes the target from A.
    const revoke = await ownerClient(
      "DELETE",
      `/api/organizations/${a}/members/${memberIds.revokeTarget}`,
    );
    expect(revoke).toEqual({
      status: 200,
      json: {
        member: {
          id: memberIds.revokeTarget,
          userId: ids.target,
          organizationId: a,
          role: "admin",
        },
      },
    });
    expect(
      (
        await owner.sql.query<{ organization_id: string }>(
          "select organization_id from member where user_id = $1",
          [ids.target],
        )
      ).rows,
    ).toEqual([{ organization_id: b }]);
    expect(
      (
        await owner.sql.query<{ last_active_tenant_id: string | null }>(
          'select last_active_tenant_id from "user" where id = $1',
          [ids.target],
        )
      ).rows[0]?.last_active_tenant_id,
    ).toBeNull();
    expect(await mirrors()).toEqual([null, null]);

    // Both still-valid sessions are denied on the next A request and mutation,
    // with one body that does not reveal whether A exists.
    for (const session of [targetSession1, targetSession2]) {
      const denials = [
        await session("GET", `/api/organizations/${a}/members`),
        await session(
          "PATCH",
          `/api/organizations/${a}/members/${memberIds.revokeAdmin}/role`,
          { role: "viewer" },
        ),
        await session(
          "DELETE",
          `/api/organizations/${a}/members/${memberIds.revokeAdmin}`,
        ),
        await session("PATCH", "/api/me/active-org", { organizationId: a }),
      ];
      for (const denial of denials) {
        expect(denial.status).toBe(403);
        expect(denial.json).toMatchObject({
          error: { code: "MEMBERSHIP_DENIED" },
        });
      }
      const context = await session("GET", "/api/me/context");
      expect(context.status).toBe(200);
      const body = context.json as {
        organizations: { id: string }[];
        lastActiveTenantId: string | null;
      };
      expect(body.organizations.map((org) => org.id)).toEqual([b]);
      expect(body.lastActiveTenantId).toBeNull();
      expect(JSON.stringify(body)).not.toContain(a);
      // The session survives.
      expect((await session("GET", "/api/auth/get-session")).status).toBe(200);
    }
    // A missing Organization gets the same denial as the one the session left.
    const missingOrganization = await targetSession1(
      "DELETE",
      `/api/organizations/${crypto.randomUUID()}/members/${memberIds.revokeAdmin}`,
    );
    const revokedOrganization = await targetSession1(
      "DELETE",
      `/api/organizations/${a}/members/${memberIds.revokeAdmin}`,
    );
    expect(missingOrganization.status).toBe(403);
    expect(missingOrganization).toEqual(revokedOrganization);
    // Denial logs after the revoke carry the actor and action, never tenant data.
    const denialLogs = auditLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "organization access denied");
    expect(denialLogs.length).toBeGreaterThan(0);
    for (const denial of denialLogs) {
      expect(typeof denial.actorUserId).toBe("string");
    }
    expect(
      denialLogs.filter(
        (entry) =>
          entry.action === "organization.member.revoke" &&
          entry.code === "MEMBERSHIP_DENIED" &&
          entry.actorUserId === ids.target,
      ),
    ).toHaveLength(4);
    const finalLogs = auditLines.join("\n");
    for (const secret of [
      a,
      memberIds.revokeOwner,
      memberIds.revokeAdmin,
      memberIds.revokeTarget,
      emails.revokeOwner,
      emails.revokeAdmin,
      emails.revokeTarget,
    ]) {
      expect(finalLogs).not.toContain(secret);
    }
    // B remains selectable from the revoked user's session.
    expect(
      (
        await targetSession1("PATCH", "/api/me/active-org", {
          organizationId: b,
        })
      ).status,
    ).toBe(200);
    // The denied A mutations changed nothing.
    expect(
      (
        await owner.sql.query<{ id: string; role: string }>(
          "select id, role from member where organization_id = $1 order by id",
          [a],
        )
      ).rows.sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      [
        { id: memberIds.revokeOwner, role: "owner" },
        { id: memberIds.revokeAdmin, role: "admin" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  }, 120_000);
});

describe("organization member self-leave HTTP contract", () => {
  it("lets every role leave A, keeps B and the account, and denies the same session's next A request without leaking data", async () => {
    const keys = {
      owner: "leaveOwner",
      admin: "leaveAdmin",
      viewer: "leaveViewer",
      auditor: "leaveAuditor",
    } as const;
    const clients = {
      owner: await admit("leaveOwner"),
      admin: await admit("leaveAdmin"),
      viewer: await admit("leaveViewer"),
      auditor: await admit("leaveAuditor"),
    };
    await admit("leaveOwner2");
    const a = leaveOrganizationId;
    const b = leaveOtherOrganizationId;
    const uid = (key: keyof typeof emails) => {
      const id = userIds.get(key);
      if (!id) throw new Error(`${key} user missing`);
      return id;
    };
    const memberOf = (key: keyof typeof emails, org: string) =>
      `leave-${key}-${org === a ? "a" : "b"}-${run}`;
    const insertMember = (
      key: keyof typeof emails,
      org: string,
      role: string,
    ) =>
      owner.sql.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [memberOf(key, org), org, uid(key), role],
      );
    await insertMember("leaveOwner2", a, "owner");
    for (const role of leaveRoles) {
      await insertMember(keys[role], a, role);
      await insertMember(keys[role], b, "viewer");
    }
    const sensitive = [
      a,
      ...Object.keys(emails)
        .filter((key) => key.startsWith("leave"))
        .map((key) => emails[key as keyof typeof emails]),
      ...leaveRoles.map((role) => memberOf(keys[role], a)),
    ];

    for (const role of leaveRoles) {
      const key = keys[role];
      const session = clients[role];
      expect(
        (await session("PATCH", "/api/me/active-org", { organizationId: a }))
          .status,
      ).toBe(200);
      auditLines.length = 0;
      const left = await session(
        "DELETE",
        `/api/organizations/${a}/members/me`,
      );
      expect(left).toEqual({
        status: 200,
        json: {
          member: {
            id: memberOf(key, a),
            userId: uid(key),
            organizationId: a,
            role,
          },
        },
      });
      // Account, B membership and session survive; A mirrors are cleared.
      expect(
        (
          await owner.sql.query<{ organization_id: string }>(
            "select organization_id from member where user_id = $1",
            [uid(key)],
          )
        ).rows,
      ).toEqual([{ organization_id: b }]);
      expect(
        (
          await owner.sql.query<{ last_active_tenant_id: string | null }>(
            'select last_active_tenant_id from "user" where id = $1',
            [uid(key)],
          )
        ).rows,
      ).toEqual([{ last_active_tenant_id: null }]);
      expect(
        (
          await owner.sql.query<{ active_organization_id: string | null }>(
            "select active_organization_id from session where user_id = $1",
            [uid(key)],
          )
        ).rows.every((row) => row.active_organization_id === null),
      ).toBe(true);
      expect((await session("GET", "/api/auth/get-session")).status).toBe(200);

      // The next A request from the same session is denied identically to a
      // missing Organization.
      const denials = [
        await session("GET", `/api/organizations/${a}/members`),
        await session("DELETE", `/api/organizations/${a}/members/me`),
        await session("PATCH", "/api/me/active-org", { organizationId: a }),
      ];
      for (const denial of denials) {
        expect(denial.status).toBe(403);
        expect(denial.json).toMatchObject({
          error: { code: "MEMBERSHIP_DENIED" },
        });
        expect(JSON.stringify(denial.json)).not.toContain(a);
      }
      const missing = await session(
        "DELETE",
        `/api/organizations/${crypto.randomUUID()}/members/me`,
      );
      expect(missing).toEqual(denials[1]);
      const context = await session("GET", "/api/me/context");
      expect(context.status).toBe(200);
      const body = context.json as {
        organizations: { id: string }[];
        lastActiveTenantId: string | null;
      };
      expect(body.organizations.map((org) => org.id)).toEqual([b]);
      expect(body.lastActiveTenantId).toBeNull();
      expect(JSON.stringify(body)).not.toContain(a);
      const logs = auditLines.join("\n");
      for (const value of sensitive) expect(logs).not.toContain(value);
    }

    // Everyone else left; the remaining owner is now the last owner.
    const remaining = await owner.sql.query<{ role: string }>(
      "select role from member where organization_id = $1",
      [a],
    );
    expect(remaining.rows).toEqual([{ role: "owner" }]);
    const owner2 = client();
    expect(
      (
        await owner2("POST", "/api/auth/sign-in/email", {
          email: emails.leaveOwner2,
          password,
        })
      ).status,
    ).toBe(200);
    const lastOwner = await owner2(
      "DELETE",
      `/api/organizations/${a}/members/me`,
    );
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.json).toMatchObject({ error: { code: "LAST_OWNER" } });
    expect(
      (
        await owner.sql.query(
          "select 1 from member where organization_id = $1",
          [a],
        )
      ).rows,
    ).toHaveLength(1);
  }, 180_000);
});

describe("native Better Auth organization routes (hotfix)", () => {
  const blockedPaths = [
    "/organization/list-invitations",
    "/organization/get-full-organization",
    "/organization/cancel-invitation",
    "/organization/get-invitation",
    "/organization/reject-invitation",
    "/organization/list-user-invitations",
    "/organization/list-members",
    "/organization/get-active-member-role",
    "/organization/delete",
  ];

  it("denies all 9 paths for every role and method, leaving invitations and the organization untouched", async () => {
    const roles = [
      ["nativeViewer", "viewer"],
      ["nativeAdmin", "admin"],
      ["nativeOwner", "owner"],
    ] as const;
    const clients = new Map<string, Client>();
    for (const [key, role] of roles) {
      const request = await admit(key, nativeOrganizationId);
      const userId = userIds.get(key);
      if (!userId) throw new Error(`native user missing for ${role}`);
      await owner.sql.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [crypto.randomUUID(), nativeOrganizationId, userId, role],
      );
      await owner.sql.query(
        "update session set active_organization_id = $1 where user_id = $2",
        [nativeOrganizationId, userId],
      );
      clients.set(role, request);
    }
    const ownerInvitationId = crypto.randomUUID();
    const inviteeEmail = `native-invitee-${run}@example.test`;
    await owner.sql.query(
      `insert into invitation
         (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
       values ($1, $2, $3, 'owner', 'pending', $4, now() + interval '1 day', now())`,
      [ownerInvitationId, nativeOrganizationId, inviteeEmail, inviterId],
    );
    const ownerUserId = userIds.get("nativeOwner") ?? "";
    const denied = {
      error: {
        code: "PERMISSION_DENIED",
        message: "ใช้เส้นทางจัดการสมาชิกใหม่",
      },
    };
    const body = {
      organizationId: nativeOrganizationId,
      invitationId: ownerInvitationId,
    };
    const query = `?organizationId=${nativeOrganizationId}&userId=${ownerUserId}&id=${ownerInvitationId}`;

    auditLines.length = 0;
    let requests = 0;
    for (const [, role] of roles) {
      const request = clients.get(role);
      if (!request) throw new Error(`client missing for ${role}`);
      for (const path of blockedPaths) {
        for (const method of ["GET", "POST"] as const) {
          const response =
            method === "GET"
              ? await request("GET", `/api/auth${path}${query}`)
              : await request("POST", `/api/auth${path}`, body);
          expect({ role, path, method, ...response }).toEqual({
            role,
            path,
            method,
            status: 403,
            json: denied,
          });
          requests += 1;
        }
      }
    }
    const adminRequest = clients.get("admin");
    if (!adminRequest) throw new Error("admin client missing");
    // Spelling variants of one blocked path must hit the same denial.
    for (const variant of [
      "/api/auth/organization/list-members/",
      "/api/auth/Organization/List-Members",
      "/api/auth/organization/list%2Dmembers",
      "/api/auth//organization/list-members",
    ]) {
      expect({ variant, ...(await adminRequest("GET", variant)) }).toEqual({
        variant,
        status: 403,
        json: denied,
      });
      requests += 1;
    }

    const state = await owner.sql.query<{ status: string; orgs: number }>(
      `select i.status,
              (select count(*)::int from organization where id = $2) as orgs
         from invitation i where i.id = $1`,
      [ownerInvitationId, nativeOrganizationId],
    );
    expect(state.rows).toEqual([{ status: "pending", orgs: 1 }]);

    const denials = auditLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "organization access denied");
    expect(denials).toHaveLength(requests);
    for (const entry of denials) {
      expect(entry).toMatchObject({ code: "PERMISSION_DENIED" });
      const baseFields = ["level", "time", "name", "msg", "pid", "hostname"];
      expect(
        Object.keys(entry)
          .filter((key) => !baseFields.includes(key))
          .sort(),
      ).toEqual(["action", "actorUserId", "code"]);
      expect(String(entry.action)).toMatch(
        /^legacy:\/api\/auth\/organization\//,
      );
    }
    const serialized = auditLines.join("\n");
    for (const sensitive of [
      inviteeEmail,
      ownerInvitationId,
      nativeOrganizationId,
      ...Object.values(emails),
      password,
      "session_token",
      "cookie",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  }, 120_000);
});
