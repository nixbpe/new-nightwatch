import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { OpenAPIHono } from "@hono/zod-openapi";
import { meContextResponseSchema } from "@nightwatch/api-contract";
import {
  createDatabase,
  insertAccountNotificationIntent,
  type Database,
  type NotificationTransaction,
  runMigrations,
} from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import { createAuth } from "./index";
import type { Mailer, OutboundMail } from "./mailer";

import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { withAccountNotificationOrigins } from "./auth-origin-intents";
// Integration project only; assertions are observable HTTP or SQL outcomes,
// never hook internals.

// Throws at module load so a misconfigured run fails instead of skipping or
// borrowing runtime grants.
const { runtimeUrl: DATABASE_URL, ownerUrl: OWNER_URL } =
  requireIntegrationDatabaseUrls();
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

const APP_URL = "http://localhost:5173";
const RUN = crypto.randomUUID().slice(0, 8);
const ORG_ID = crypto.randomUUID();
const ORG_SLUG = `auth-it-${RUN}`;
const PASSWORD = "Auth-It-Passw0rd!";
const OWNER_INVITER_EMAIL = `inviter-${RUN}@example.test`;
const EXPIRED_INVITATION_ID = crypto.randomUUID();

const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL,
  BETTER_AUTH_SECRET: `auth-it-secret-${RUN}-0123456789abcdef`,
  APP_URL,
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: APP_URL,
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "NightWatch IT <no-reply@nightwatch.test>",
};

const mail: OutboundMail[] = [];
const mailer: Mailer = {
  send: (outbound) => {
    mail.push(outbound);
    return Promise.resolve();
  },
  verify: () => Promise.resolve(),
};

// Connects lazily, so beforeAll migrates and seeds before first use.
const database: Database = createDatabase(DATABASE_URL);
const ownerDatabase: Database = createDatabase(OWNER_URL);
const orgName = "Auth IT Org";
let app: OpenAPIHono;
const passwordOriginFixtureEmails: string[] = [];
const mfaReenrollmentFixtureEmails: string[] = [];
const memberGuardFixtureEmails: string[] = [];
const memberGuardOrganizationIds: string[] = [];
const MFA_REENROLL_TRIGGER = `fail_two_factor_insert_${RUN}`;
function userEmail(local: string): string {
  return `${local}-${RUN}@example.test`;
}

type ApiRequestOptions = {
  /** Sent as `X-Invitation-ID`, like the onboarding UI. */
  invitationId?: string;
};

type ApiResponse = { status: number; json: unknown };

type ApiRequest = ((
  method: "DELETE" | "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
  options?: ApiRequestOptions,
) => Promise<ApiResponse>) & {
  cookies: () => Record<string, string>;
};

// Sends the trusted SPA origin on writes.
function client(
  targetApp?: OpenAPIHono,
  initialCookies?: Record<string, string>,
): ApiRequest {
  const jar = new Map<string, string>(Object.entries(initialCookies ?? {}));
  const request = async (
    method: "DELETE" | "GET" | "POST" | "PATCH",
    path: string,
    body?: Record<string, unknown>,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse> => {
    const headers = new Headers();
    if (jar.size > 0) {
      headers.set(
        "cookie",
        [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
      );
    }
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      headers.set("origin", APP_URL);
    }
    if (options?.invitationId !== undefined) {
      headers.set("x-invitation-id", options.invitationId);
    }
    const response = await (targetApp ?? app).request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const pair = setCookie.split(";")[0];
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    return { status: response.status, json };
  };
  return Object.assign(request, {
    cookies: () => Object.fromEntries(jar),
  });
}

function findMail(to: string, subjectPart: string): OutboundMail {
  const found = mail.find(
    (entry) => entry.to === to && entry.subject.includes(subjectPart),
  );
  if (!found) throw new Error(`no mail to ${to} matching "${subjectPart}"`);

  return found;
}
function latestMail(to: string, subjectPart: string): OutboundMail {
  const found = [...mail]
    .reverse()
    .find((entry) => entry.to === to && entry.subject.includes(subjectPart));
  if (!found) throw new Error(`no mail to ${to} matching "${subjectPart}"`);
  return found;
}

function linkQuery(mailText: string, param: string): string {
  const match = new RegExp(`${param}=([^\\s&]+)`).exec(mailText);
  const value = match?.[1];
  if (value === undefined) throw new Error(`no ${param} in mail text`);
  return decodeURIComponent(value);
}

function invitationIdFromMail(mailText: string): string {
  const link = /https?:\/\/[^\s<>'"]+/.exec(mailText)?.[0];
  if (!link) throw new Error("no link in invitation mail");
  const id = /\/accept-invitation\/([^/]+)/.exec(new URL(link).pathname)?.[1];
  if (!id) throw new Error("no invitation id in invitation mail link");
  return decodeURIComponent(id);
}

// Real RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so two-factor runs end to end;
// never log the secret.
function base32Decode(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error("invalid base32 secret in TOTP URI");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secretBase32: string, atMs = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offsetByte = hmac[hmac.length - 1];
  if (offsetByte === undefined) throw new Error("empty TOTP hmac");
  const code = hmac.readUInt32BE(offsetByte & 0x0f) & 0x7fffffff;
  return String(code % 1_000_000).padStart(6, "0");
}

function totpSecretFromUri(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error("no secret in TOTP URI");
  return secret;
}

async function sqlUserId(email: string): Promise<string> {
  const result = await database.sql.query<{ id: string }>(
    'select id from "user" where email = $1',
    [email.toLowerCase()],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`no user row for ${email}`);
  return id;
}

async function mfaProjectionEnabled(userId: string): Promise<boolean | null> {
  const client = await database.sql.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await client.query<{ verified_enabled: boolean }>(
      "select verified_enabled from notification_account_mfa_state where user_id = $1",
      [userId],
    );
    await client.query("commit");
    return result.rows[0]?.verified_enabled ?? null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function mfaIntentCount(userId: string): Promise<number> {
  const client = await database.sql.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n
       from notification_intents
       where user_id = $1 and event_type in ('MFA_ENABLED', 'MFA_DISABLED')`,
      [userId],
    );
    await client.query("commit");
    return result.rows[0]?.n ?? 0;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

type PasswordOriginSnapshot = {
  credentialCount: number;
  inboxCount: number;
  intentCount: number;
  ledgerCount: number;
  passwordHash: string | null;
};

async function passwordOriginSnapshot(
  userId: string,
): Promise<PasswordOriginSnapshot> {
  const result = await ownerDatabase.sql.query<PasswordOriginSnapshot>(
    `select
       (select count(*)::int from account
        where user_id = $1 and provider_id = 'credential') as "credentialCount",
       (select count(*)::int from notification_intents
        where user_id = $1 and event_type = 'PASSWORD_CHANGED') as "intentCount",
       (select count(*)::int from notification_dispatch_ledger as ledger
        join notification_intents as intent on intent.id = ledger.intent_id
        where intent.user_id = $1 and intent.event_type = 'PASSWORD_CHANGED') as "ledgerCount",
       (select count(*)::int from notification_inbox_items
        where user_id = $1 and event_type = 'PASSWORD_CHANGED') as "inboxCount",
       (select password from account
        where user_id = $1 and provider_id = 'credential'
        limit 1) as "passwordHash"`,
    [userId],
  );
  const snapshot = result.rows[0];
  if (!snapshot) throw new Error(`missing password origin state for ${userId}`);
  return snapshot;
}

function sessionHeaders(request: ApiRequest): Headers {
  return new Headers({
    cookie: Object.entries(request.cookies())
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
  });
}

async function membershipCount(
  organizationId: string,
  userId: string,
): Promise<number> {
  const result = await database.sql.query<{ n: number }>(
    "select count(*)::int as n from member where organization_id = $1 and user_id = $2",
    [organizationId, userId],
  );
  return result.rows[0]?.n ?? 0;
}

type MemberMutationSnapshot = {
  targetRole: string | null;
  targetMembership: number;
  leaverMembership: number;
  targetLastActiveOrganizationId: string | null;
  leaverLastActiveOrganizationId: string | null;
  targetActiveOrganizationSessions: number;
  leaverActiveOrganizationSessions: number;
  notificationIntentCount: number;
  notificationLedgerCount: number;
};

async function memberMutationSnapshot(
  organizationId: string,
  ownerId: string,
  targetMemberId: string,
  targetUserId: string,
  leaverUserId: string,
): Promise<MemberMutationSnapshot> {
  const result = await ownerDatabase.sql.query<MemberMutationSnapshot>(
    `select
       (select role from member where id::text = $1) as "targetRole",
       (select count(*)::int from member where organization_id::text = $2 and user_id::text = $3) as "targetMembership",
       (select count(*)::int from member where organization_id::text = $2 and user_id::text = $4) as "leaverMembership",
       (select last_active_tenant_id from "user" where id::text = $3) as "targetLastActiveOrganizationId",
       (select last_active_tenant_id from "user" where id::text = $4) as "leaverLastActiveOrganizationId",
       (select count(*)::int from session where user_id::text = $3 and active_organization_id::text = $2) as "targetActiveOrganizationSessions",
       (select count(*)::int from session where user_id::text = $4 and active_organization_id::text = $2) as "leaverActiveOrganizationSessions",
       (select count(*)::int from notification_intents
        where tenant_id::text = $2 or user_id::text = any($5::text[])) as "notificationIntentCount",
       (select count(*)::int from notification_dispatch_ledger as ledger
        join notification_intents as intent on intent.id = ledger.intent_id
        where intent.tenant_id::text = $2 or intent.user_id::text = any($5::text[])) as "notificationLedgerCount"`,
    [
      targetMemberId,
      organizationId,
      targetUserId,
      leaverUserId,
      [ownerId, targetUserId, leaverUserId],
    ],
  );
  const snapshot = result.rows[0];
  if (!snapshot) throw new Error("member mutation snapshot missing");
  return snapshot;
}

async function invitationStatus(invitationId: string): Promise<string | null> {
  const result = await database.sql.query<{ status: string }>(
    "select status from invitation where id = $1",
    [invitationId],
  );
  return result.rows[0]?.status ?? null;
}

async function admitUser(
  local: string,
  invitationId: string,
): Promise<{ email: string; request: ApiRequest }> {
  const request = client();
  const email = userEmail(local);
  const signup = await request(
    "POST",
    "/api/auth/sign-up/email",
    {
      name: `IT ${local}`,
      email,
      password: PASSWORD,
      callbackURL: `/onboarding?invitationId=${invitationId}`,
    },
    { invitationId },
  );
  expect(signup.status).toBe(200);

  const verification = findMail(email, "ยืนยันอีเมล");
  const token = linkQuery(verification.text, "emailVerificationToken");
  const verify = await request(
    "GET",
    `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
  );
  expect(verify.status).toBeLessThan(500);

  const signIn = await request("POST", "/api/auth/sign-in/email", {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);
  return { email, request };
}

async function createInvitation(
  email: string,
  role: "owner" | "viewer" = "viewer",
  organizationId = ORG_ID,
): Promise<string> {
  const inviter = await database.sql.query<{ id: string }>(
    'select id from "user" where email = $1',
    [OWNER_INVITER_EMAIL],
  );
  const inviterId = inviter.rows[0]?.id;
  if (!inviterId) throw new Error("seeded inviter missing");
  const invitationId = crypto.randomUUID();
  await database.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, $4, 'pending', $5, now() + interval '2 days', now())`,
    [invitationId, organizationId, email, role, inviterId],
  );
  return invitationId;
}

// Org-scoped Better Auth APIs such as invite-member resolve the session's
// active organization.
async function signInOwner(): Promise<ApiRequest> {
  const owner = client();
  const signIn = await owner("POST", "/api/auth/sign-in/email", {
    email: userEmail("gate"),
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);
  const activate = await owner("PATCH", "/api/me/active-org", {
    organizationId: ORG_ID,
  });
  expect(activate.status).toBe(200);
  return owner;
}

beforeAll(async () => {
  await runMigrations({ url: OWNER_URL, migrationsDir: MIGRATIONS_DIR });
  await database.sql.query(
    "insert into organization (id, name, slug, created_at) values ($1, $2, $3, now())",
    [ORG_ID, orgName, ORG_SLUG],
  );
  const inviterId = crypto.randomUUID();
  await database.sql.query(
    'insert into "user" (id, name, email, created_at) values ($1, $2, $3, now())',
    [inviterId, "Seeded Inviter", OWNER_INVITER_EMAIL],
  );
  await database.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, 'owner', 'pending', $4, now() + interval '2 days', now())`,
    [crypto.randomUUID(), ORG_ID, userEmail("gate"), inviterId],
  );
  // Two invitations for one mailbox: the second signup must hit the
  // duplicate-account path, not the invitation denial.
  await database.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, 'viewer', 'pending', $4, now() + interval '2 days', now())`,
    [crypto.randomUUID(), ORG_ID, userEmail("dup"), inviterId],
  );
  await database.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, 'viewer', 'pending', $4, now() + interval '2 days', now())`,
    [crypto.randomUUID(), ORG_ID, userEmail("dup"), inviterId],
  );
  // An expired invitation must be denied exactly like a missing or unknown one.
  await database.sql.query(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
     values ($1, $2, $3, 'viewer', 'pending', $4, now() - interval '1 hour', now())`,
    [EXPIRED_INVITATION_ID, ORG_ID, userEmail("expired"), inviterId],
  );

  const auth = createAuth({
    env,
    authEnv,
    logger: createLogger({ level: "silent", name: "auth-it" }),
    database,
    mailer,
  });
  app = createApp({
    env,
    authEnv,
    logger: createLogger({ level: "silent", name: "auth-it" }),
    auth,
    database,
    mailer,
  });
}, 120_000);

afterAll(async () => {
  const fixtureEmails = [
    ...passwordOriginFixtureEmails,
    ...mfaReenrollmentFixtureEmails,
    ...memberGuardFixtureEmails,
  ];
  if (fixtureEmails.length > 0) {
    await database.sql.query(
      "delete from invitation where email = any($1::text[])",
      [fixtureEmails],
    );
    await database.sql.query(
      'delete from "user" where email = any($1::text[])',
      [fixtureEmails],
    );
  }
  if (memberGuardOrganizationIds.length > 0) {
    await ownerDatabase.sql.query(
      "delete from organization where id = any($1::uuid[])",
      [memberGuardOrganizationIds],
    );
  }
  await ownerDatabase.close();
  await database.close();
});

describe("Better Auth failure diagnostics", () => {
  it("keeps invitation IDs and raw SQL out of the raw signup response and logs", async () => {
    const invitationId = `invite-${crypto.randomUUID()}`;
    const sqlMarker = `select CRR01_SECRET_${crypto.randomUUID()}`;
    const databaseError = Object.assign(
      new Error(`invitation lookup failed for ${invitationId}: ${sqlMarker}`),
      {
        cause: `driver cause ${invitationId}`,
        query: sqlMarker,
        params: [invitationId],
      },
    );
    const failingDatabase = {
      db: database.db,
      sql: {
        query: () => Promise.reject(databaseError),
      } as unknown as Database["sql"],
      close: () => Promise.resolve(),
    } satisfies Database;

    let pinoOutput = "";
    const errorLogger = createLogger(
      { level: "error", name: "auth-crr01" },
      {
        write: (chunk: string) => {
          pinoOutput += chunk;
        },
      },
    );
    const consoleErrors: unknown[][] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args);
      });

    try {
      const failingAuth = createAuth({
        env,
        authEnv,
        logger: errorLogger,
        database: failingDatabase,
        mailer,
      });
      const response = await failingAuth.handler(
        new Request(`${authEnv.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: APP_URL,
            "x-invitation-id": invitationId,
          },
          body: JSON.stringify({
            name: "CRR-01 failure",
            email: userEmail("crr01-failure"),
            password: PASSWORD,
          }),
        }),
      );
      const responseText = await response.text();
      const capturedOutput = `${pinoOutput}\n${JSON.stringify(consoleErrors)}`;

      expect(response.status).toBe(500);
      expect(JSON.parse(responseText)).toEqual({
        code: "AUTH_INTERNAL_ERROR",
        message: "ไม่สามารถดำเนินการยืนยันตัวตนได้",
      });
      expect(`${responseText}\n${capturedOutput}`).not.toContain(invitationId);
      expect(`${responseText}\n${capturedOutput}`).not.toContain(sqlMarker);
      expect(capturedOutput).toContain('"component":"better-auth"');
      expect(capturedOutput).toContain('"event":"api_error"');
      expect(capturedOutput).toContain(
        '"msg":"authentication API request failed"',
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("invitation-gated signup against the real boundary", () => {
  // Every denial returns the same generic message (no enumeration) and writes
  // no user row.
  const DENIAL_MESSAGE = "การสมัครสมาชิกต้องได้รับคำเชิญ";

  async function expectDenied(
    response: { status: number; json: unknown },
    email: string,
  ): Promise<void> {
    expect(response.status).toBe(403);
    const body = response.json as { message?: string };
    expect(body.message).toContain(DENIAL_MESSAGE);
    const count = await database.sql.query<{ n: number }>(
      'select count(*)::int as n from "user" where email = $1',
      [email],
    );
    expect(count.rows[0]?.n).toBe(0);
  }

  it("refuses a raw signup without the invitation header, fail-closed", async () => {
    const response = await client()("POST", "/api/auth/sign-up/email", {
      name: "Stranger",
      email: userEmail("stranger"),
      password: PASSWORD,
    });
    await expectDenied(response, userEmail("stranger"));
  });

  it("refuses a signup presenting an unknown or expired invitation header", async () => {
    const unknown = await client()(
      "POST",
      "/api/auth/sign-up/email",
      {
        name: "Unknown Invite",
        email: userEmail("unknown-invite"),
        password: PASSWORD,
      },
      { invitationId: crypto.randomUUID() },
    );
    await expectDenied(unknown, userEmail("unknown-invite"));

    const expired = await client()(
      "POST",
      "/api/auth/sign-up/email",
      {
        name: "Expired Invite",
        email: userEmail("expired"),
        password: PASSWORD,
      },
      { invitationId: EXPIRED_INVITATION_ID },
    );
    await expectDenied(expired, userEmail("expired"));
  });

  it("serves the public preview only for a pending invitation", async () => {
    const pending = await database.sql.query<{ id: string }>(
      "select id from invitation where organization_id = $1 and email = $2 and status = 'pending'",
      [ORG_ID, userEmail("gate")],
    );
    const id = pending.rows[0]?.id;
    if (!id) throw new Error("seeded pending invitation missing");
    const preview = await client()("GET", `/api/onboarding/invitations/${id}`);
    expect(preview.status).toBe(200);
    const body = preview.json as {
      invitation: { organizationName: string; role: string };
    };
    expect(body.invitation.organizationName).toBe(orgName);
    expect(body.invitation.role).toBe("owner");

    const missing = await client()(
      "GET",
      "/api/onboarding/invitations/no-such-invitation",
    );
    expect(missing.status).toBe(404);
    expect((missing.json as { error: { code: string } }).error.code).toBe(
      "INVITATION_NOT_FOUND",
    );
  });
});

describe("verification continuation and explicit acceptance", () => {
  it("carries the invitation through the verification mail and accepts once", async () => {
    const gate = client();
    const invitations = await database.sql.query<{ id: string }>(
      "select id from invitation where organization_id = $1 and email = $2 and status = 'pending'",
      [ORG_ID, userEmail("gate")],
    );
    const invitationId = invitations.rows[0]?.id;
    if (!invitationId) throw new Error("seeded gate invitation missing");

    const signup = await gate(
      "POST",
      "/api/auth/sign-up/email",
      {
        name: "Gate Owner",
        email: userEmail("gate"),
        password: PASSWORD,
        callbackURL: `/onboarding?invitationId=${invitationId}`,
      },
      { invitationId },
    );
    expect(signup.status).toBe(200);

    const verification = findMail(userEmail("gate"), "ยืนยันอีเมล");
    expect(verification.text).toContain("emailVerificationToken=");
    expect(verification.text).toContain(`invitationId=${invitationId}`);
    expect(verification.text).not.toContain("ใช้ได้ครั้งเดียว");

    const token = linkQuery(verification.text, "emailVerificationToken");
    const verify = await gate(
      "GET",
      `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    );
    expect(verify.status).toBeLessThan(500);
    const verified = await database.sql.query<{ email_verified: boolean }>(
      'select email_verified from "user" where email = $1',
      [userEmail("gate")],
    );
    expect(verified.rows[0]?.email_verified).toBe(true);

    const signIn = await gate("POST", "/api/auth/sign-in/email", {
      email: userEmail("gate"),
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    const session = await gate("GET", "/api/auth/get-session");
    expect(session.status).toBe(200);
    const sessionBody = session.json as {
      user: { emailVerified: boolean };
      session: { token: string };
    };
    expect(sessionBody.user.emailVerified).toBe(true);

    const accept = await gate(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(accept.status).toBe(200);
    expect(accept.json).toEqual({ organizationId: ORG_ID });
    expect(await invitationStatus(invitationId)).toBe("accepted");
    const userId = await sqlUserId(userEmail("gate"));
    expect(await membershipCount(ORG_ID, userId)).toBe(1);

    const replay = await gate(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(replay).toEqual({
      status: 404,
      json: {
        error: {
          code: "INVITATION_NOT_FOUND",
          message: "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
        },
      },
    });
  });
});

describe("concurrent acceptance race", () => {
  it("accepts once under concurrency and cannot restore membership after owner removal", async () => {
    const owner = await signInOwner();
    const invite = await owner(
      "POST",
      `/api/organizations/${ORG_ID}/invitations`,
      {
        email: userEmail("race"),
        role: "viewer",
      },
    );
    expect(invite.status).toBe(201);

    const invitationId = invitationIdFromMail(
      findMail(userEmail("race"), "คำเชิญ").text,
    );

    const raceUser = await admitUser("race", invitationId);
    const userId = await sqlUserId(raceUser.email);

    const holder = await database.sql.connect();
    let transactionOpen = false;
    let accepts: Promise<ApiResponse[]> | undefined;
    let results: ApiResponse[];
    try {
      await holder.query("begin");
      transactionOpen = true;
      const locked = await holder.query<{ pid: number }>(
        "select pg_backend_pid() as pid from invitation where id = $1 for update",
        [invitationId],
      );
      const holderPid = locked.rows[0]?.pid;
      if (holderPid === undefined)
        throw new Error("race invitation lock was not acquired");

      accepts = Promise.all(
        Array.from({ length: 4 }, () =>
          raceUser.request(
            "POST",
            `/api/onboarding/invitations/${invitationId}/accept`,
          ),
        ),
      );
      // Count indirect blockers: later waiters may queue behind another accept.
      const deadline = Date.now() + 10_000;
      let blocked = 0;
      while (blocked !== 4 && Date.now() < deadline) {
        const waiters = await database.sql.query<{ n: number }>(
          `with recursive blocked_by(pid) as (
             select $1::int
             union
             select activity.pid
             from pg_stat_activity activity
             join blocked_by blocker
               on blocker.pid = any(pg_blocking_pids(activity.pid))
           )
           select count(*)::int as n from blocked_by where pid <> $1`,
          [holderPid],
        );
        blocked = waiters.rows[0]?.n ?? 0;
      }
      expect(
        blocked,
        "all four accepts must wait behind this invitation lock",
      ).toBe(4);
      await holder.query("commit");
      transactionOpen = false;
      results = await accepts;
    } finally {
      try {
        if (transactionOpen) await holder.query("rollback");
      } finally {
        holder.release();
        // Settle only after releasing the blocker so no in-flight work leaks
        // into another test.
        await accepts?.catch(() => undefined);
      }
    }
    for (const [index, result] of results.entries()) {
      expect(
        result.status,
        `attempt ${String(index)} must not 5xx`,
      ).toBeLessThan(500);
    }
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 404)).toHaveLength(3);
    expect(await membershipCount(ORG_ID, userId)).toBe(1);
    expect(await invitationStatus(invitationId)).toBe("accepted");

    const member = await database.sql.query<{ id: string }>(
      "select id from member where organization_id = $1 and user_id = $2",
      [ORG_ID, userId],
    );
    const memberId = member.rows[0]?.id;
    if (!memberId) throw new Error("accepted member missing");
    const remove = await owner(
      "DELETE",
      `/api/organizations/${ORG_ID}/members/${memberId}`,
    );
    expect(remove.status).toBe(200);
    expect(await membershipCount(ORG_ID, userId)).toBe(0);
    const removedContext = await raceUser.request("GET", "/api/me/context");
    expect(removedContext.status).toBe(200);
    expect(meContextResponseSchema.parse(removedContext.json)).toMatchObject({
      organizations: [],
      lastActiveTenantId: null,
    });

    // Same live id: the denial must come from consumption, not expiry.
    const invitation = await database.sql.query<{ unexpired: boolean }>(
      "select expires_at > now() as unexpired from invitation where id = $1",
      [invitationId],
    );
    expect(invitation.rows[0]?.unexpired).toBe(true);
    const replay = await raceUser.request(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(replay.status).toBe(404);
    expect(await invitationStatus(invitationId)).toBe("accepted");
    expect(await membershipCount(ORG_ID, userId)).toBe(0);
    const replayContext = await raceUser.request("GET", "/api/me/context");
    expect(replayContext.status).toBe(200);
    expect(meContextResponseSchema.parse(replayContext.json)).toMatchObject({
      organizations: [],
      lastActiveTenantId: null,
    });
  });

  it("rejects an already-member recipient while preserving the pending invitation", async () => {
    const owner = await signInOwner();
    const invite = await owner(
      "POST",
      `/api/organizations/${ORG_ID}/invitations`,
      {
        email: userEmail("preset"),
        role: "viewer",
      },
    );
    expect(invite.status).toBe(201);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("preset"), "คำเชิญ").text,
    );

    const preset = await admitUser("preset", invitationId);
    const userId = await sqlUserId(preset.email);
    // Existing membership and pending invitation must yield a conflict.
    await database.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'viewer', now())`,
      [crypto.randomUUID(), ORG_ID, userId],
    );

    const accept = await preset.request(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(accept.status).toBe(409);
    expect(accept.json).toMatchObject({
      error: { code: "USER_ALREADY_MEMBER" },
    });
    expect(await invitationStatus(invitationId)).toBe("pending");
    expect(await membershipCount(ORG_ID, userId)).toBe(1);
  });

  it("keeps unrelated database failures visible instead of mislabeling them", async () => {
    const owner = await signInOwner();
    const invite = await owner(
      "POST",
      `/api/organizations/${ORG_ID}/invitations`,
      {
        email: userEmail("denied"),
        role: "viewer",
      },
    );
    expect(invite.status).toBe(201);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("denied"), "คำเชิญ").text,
    );
    const denied = await admitUser("denied", invitationId);

    // A dedicated read-only connection, not shared grant changes that would
    // leak into parallel scenarios.
    const readOnlyUrl = new URL(DATABASE_URL);
    readOnlyUrl.searchParams.set(
      "options",
      "-c default_transaction_read_only=on",
    );
    const readOnlyDatabase = createDatabase(readOnlyUrl.toString());
    const consoleErrors: unknown[][] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args);
      });
    try {
      const readOnlyAuth = createAuth({
        env,
        authEnv,
        logger: createLogger({ level: "silent", name: "auth-it" }),
        database: readOnlyDatabase,
        mailer,
      });
      const readOnlyApp = createApp({
        env,
        authEnv,
        logger: createLogger({ level: "silent", name: "auth-it" }),
        auth: readOnlyAuth,
        database: readOnlyDatabase,
        mailer,
      });
      const accept = await client(readOnlyApp, denied.request.cookies())(
        "POST",
        `/api/onboarding/invitations/${invitationId}/accept`,
      );
      expect(accept.status).toBe(500);
      expect(accept.json).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
      const capturedOutput = JSON.stringify(consoleErrors);
      expect(capturedOutput).not.toContain(invitationId);
      expect(capturedOutput).not.toContain('update "invitation"');
      expect(await invitationStatus(invitationId)).toBe("pending");
    } finally {
      consoleError.mockRestore();
      await readOnlyDatabase.close();
    }
  });
});

describe("native password notification origins", () => {
  it("emits once for a changed native credential hash, skips repeated identical hashes, and rolls back failed intent writes", async () => {
    const email = userEmail("password-origin");
    passwordOriginFixtureEmails.push(email);
    const invitationId = await createInvitation(email);
    const member = await admitUser("password-origin", invitationId);
    const userId = await sqlUserId(member.email);
    const initial = await passwordOriginSnapshot(userId);
    expect(initial).toMatchObject({
      credentialCount: 1,
      inboxCount: 0,
      intentCount: 0,
      ledgerCount: 0,
    });
    expect(initial.passwordHash).not.toBe(PASSWORD);

    const changedPassword = "Auth-It-ChangedPassw0rd!";
    const change = await member.request("POST", "/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: changedPassword,
    });
    expect(change.status).toBe(200);
    const afterChange = await passwordOriginSnapshot(userId);
    expect(afterChange.credentialCount).toBe(1);
    expect(afterChange.passwordHash).not.toBe(initial.passwordHash);
    expect(afterChange.intentCount).toBe(1);
    expect(afterChange.ledgerCount).toBe(1);
    expect(afterChange.inboxCount).toBe(0);

    if (!afterChange.passwordHash) throw new Error("missing credential hash");
    const sameHashAdapter =
      withAccountNotificationOrigins<NotificationTransaction>(
        drizzleAdapter(database.db, { provider: "pg", transaction: true }),
        {
          writer: {
            insertPasswordChanged: async (tx, input) => {
              await insertAccountNotificationIntent(tx, {
                ...input,
                eventType: "PASSWORD_CHANGED",
              });
            },
            initializeMfaState: () => Promise.resolve(undefined),
            recordMfaTransition: () => Promise.resolve({ transitioned: false }),
          },
          transaction: (callback) => database.db.transaction(callback),
          transactionAdapter: (tx, options) =>
            drizzleAdapter(tx, { provider: "pg", transaction: true })(options),
        },
      )({});
    const sameHashWrite = {
      model: "account",
      update: { password: afterChange.passwordHash },
      where: [
        { field: "userId", value: userId },
        { field: "providerId", value: "credential" },
      ],
    };
    await sameHashAdapter.update(sameHashWrite);
    await sameHashAdapter.update(sameHashWrite);
    expect(await passwordOriginSnapshot(userId)).toEqual(afterChange);

    const directAuth = createAuth({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      database,
      mailer,
    });
    const directPassword = "Auth-It-DirectPassw0rd!";
    await expect(
      directAuth.api.changePassword({
        body: {
          currentPassword: changedPassword,
          newPassword: directPassword,
        },
        headers: sessionHeaders(member.request),
      }),
    ).resolves.toMatchObject({ token: null });
    const afterDirectChange = await passwordOriginSnapshot(userId);
    expect(afterDirectChange.passwordHash).not.toBe(afterChange.passwordHash);
    expect(afterDirectChange.intentCount).toBe(2);
    expect(afterDirectChange.ledgerCount).toBe(2);
    expect(afterDirectChange.inboxCount).toBe(0);

    const resetRequest = await member.request(
      "POST",
      "/api/auth/request-password-reset",
      { email: member.email, redirectTo: `${APP_URL}/reset-password` },
    );
    expect(resetRequest.status).toBe(200);
    const resetToken = linkQuery(
      findMail(member.email, "รีเซ็ตรหัสผ่าน").text,
      "token",
    );
    const resetPassword = "Auth-It-ResetPassw0rd!";
    await expect(
      directAuth.api.resetPassword({
        body: { newPassword: resetPassword, token: resetToken },
      }),
    ).resolves.toEqual({ status: true });
    const afterReset = await passwordOriginSnapshot(userId);
    expect(afterReset.passwordHash).not.toBe(afterDirectChange.passwordHash);
    expect(afterReset.intentCount).toBe(3);
    expect(afterReset.ledgerCount).toBe(3);
    expect(afterReset.inboxCount).toBe(0);

    // The token is consumed before a credential update; replaying it cannot
    // create another credential mutation or account notification.
    const consumedReset = await member.request(
      "POST",
      "/api/auth/reset-password",
      { newPassword: "Auth-It-ReplayedPassw0rd!", token: resetToken },
    );
    expect(consumedReset.status).toBe(400);
    expect(await passwordOriginSnapshot(userId)).toEqual(afterReset);

    const lateFailurePassword = "Auth-It-LateFailurePassw0rd!";
    const triggerFunction = `password_origin_session_failure_${RUN}`;
    const triggerName = `password_origin_session_trigger_${RUN}`;
    try {
      await ownerDatabase.sql.query(
        `create function ${triggerFunction}() returns trigger language plpgsql as $$
         begin
           if new.user_id = '${userId}' then
             raise exception 'forced post-credential session failure';
           end if;
           return new;
         end;
         $$`,
      );
      await ownerDatabase.sql.query(
        `create trigger ${triggerName}
         before insert on session
         for each row execute function ${triggerFunction}()`,
      );
      const lateFailure = await member.request(
        "POST",
        "/api/auth/change-password",
        {
          currentPassword: resetPassword,
          newPassword: lateFailurePassword,
          revokeOtherSessions: true,
        },
      );
      expect(lateFailure.status).toBe(500);
      expect(JSON.stringify(lateFailure.json)).not.toContain(
        lateFailurePassword,
      );
      const afterLateFailure = await passwordOriginSnapshot(userId);
      expect(afterLateFailure.passwordHash).not.toBe(afterReset.passwordHash);
      expect(afterLateFailure.intentCount).toBe(4);
      expect(afterLateFailure.ledgerCount).toBe(4);
    } finally {
      await ownerDatabase.sql.query(
        `drop trigger if exists ${triggerName} on session`,
      );
      await ownerDatabase.sql.query(
        `drop function if exists ${triggerFunction}()`,
      );
    }

    const renewed = client();
    const renewedSignIn = await renewed("POST", "/api/auth/sign-in/email", {
      email: member.email,
      password: lateFailurePassword,
    });
    expect(renewedSignIn.status).toBe(200);
    const afterLateFailure = await passwordOriginSnapshot(userId);
    const failingAuth = createAuth({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      database,
      mailer,
      originWriter: {
        insertPasswordChanged: () =>
          Promise.reject(new Error("forced password intent failure")),
        initializeMfaState: () => Promise.resolve(undefined),
        recordMfaTransition: () => Promise.resolve({ transitioned: false }),
      },
    });
    const failingApp = createApp({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      auth: failingAuth,
      database,
      mailer,
    });
    const failedChange = await client(failingApp, renewed.cookies())(
      "POST",
      "/api/auth/change-password",
      {
        currentPassword: lateFailurePassword,
        newPassword: "Auth-It-FailedChangePassw0rd!",
      },
    );
    expect(failedChange.status).toBe(500);
    expect(await passwordOriginSnapshot(userId)).toEqual(afterLateFailure);
    await expect(
      failingAuth.api.changePassword({
        body: {
          currentPassword: lateFailurePassword,
          newPassword: "Auth-It-FailedDirectPassw0rd!",
        },
        headers: sessionHeaders(renewed),
      }),
    ).rejects.toThrow("forced password intent failure");
    expect(await passwordOriginSnapshot(userId)).toEqual(afterLateFailure);

    const resetFailureRequest = await member.request(
      "POST",
      "/api/auth/request-password-reset",
      { email: member.email, redirectTo: `${APP_URL}/reset-password` },
    );
    expect(resetFailureRequest.status).toBe(200);
    const failedResetToken = linkQuery(
      latestMail(member.email, "รีเซ็ตรหัสผ่าน").text,
      "token",
    );
    await expect(
      failingAuth.api.resetPassword({
        body: {
          newPassword: "Auth-It-FailedResetPassw0rd!",
          token: failedResetToken,
        },
      }),
    ).rejects.toThrow("forced password intent failure");
    expect(await passwordOriginSnapshot(userId)).toEqual(afterLateFailure);
  });

  it("writes an intent when reset creates the first credential account", async () => {
    const email = userEmail("first-credential");
    passwordOriginFixtureEmails.push(email);
    const invitationId = await createInvitation(email);
    const member = await admitUser("first-credential", invitationId);
    const userId = await sqlUserId(member.email);
    await database.sql.query(
      "delete from account where user_id = $1 and provider_id = 'credential'",
      [userId],
    );
    await database.sql.query(
      `insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
       values ($1, $2, 'google', $3, now(), now())`,
      [crypto.randomUUID(), `google-${userId}`, userId],
    );
    const oauthAdapter =
      withAccountNotificationOrigins<NotificationTransaction>(
        drizzleAdapter(database.db, { provider: "pg", transaction: true }),
        {
          writer: {
            insertPasswordChanged: async (tx, input) => {
              await insertAccountNotificationIntent(tx, {
                ...input,
                eventType: "PASSWORD_CHANGED",
              });
            },
            initializeMfaState: () => Promise.resolve(undefined),
            recordMfaTransition: () => Promise.resolve({ transitioned: false }),
          },
          transaction: (callback) => database.db.transaction(callback),
          transactionAdapter: (tx, options) =>
            drizzleAdapter(tx, { provider: "pg", transaction: true })(options),
        },
      )({});
    const oauthUpdate = await oauthAdapter.update({
      model: "account",
      update: { accessToken: "opaque-oauth-token" },
      where: [
        { field: "userId", value: userId },
        { field: "providerId", value: "google" },
      ],
    });
    expect(oauthUpdate).not.toBeNull();
    expect(await passwordOriginSnapshot(userId)).toMatchObject({
      credentialCount: 0,
      intentCount: 0,
      ledgerCount: 0,
      passwordHash: null,
    });

    const resetRequest = await member.request(
      "POST",
      "/api/auth/request-password-reset",
      { email: member.email, redirectTo: `${APP_URL}/reset-password` },
    );
    expect(resetRequest.status).toBe(200);
    const newPassword = "Auth-It-FirstCredentialPassw0rd!";
    const reset = await member.request("POST", "/api/auth/reset-password", {
      newPassword,
      token: linkQuery(findMail(member.email, "รีเซ็ตรหัสผ่าน").text, "token"),
    });
    expect(reset.status).toBe(200);
    expect(await passwordOriginSnapshot(userId)).toMatchObject({
      credentialCount: 1,
      intentCount: 1,
      ledgerCount: 1,
    });

    // The reset created the only credential, so the signup password never
    // worked and the new one signs in through the ordinary HTTP flow.
    const oldLogin = await client()("POST", "/api/auth/sign-in/email", {
      email: member.email,
      password: PASSWORD,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await client()("POST", "/api/auth/sign-in/email", {
      email: member.email,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);
  });
});

describe("TOTP challenge and session boundary", () => {
  it("never yields a session during a pending challenge and accepts a one-time backup code", async () => {
    const owner = await signInOwner();
    const invite = await owner(
      "POST",
      `/api/organizations/${ORG_ID}/invitations`,
      {
        email: userEmail("totp"),
        role: "viewer",
      },
    );
    expect(invite.status).toBe(201);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("totp"), "คำเชิญ").text,
    );
    const totp = await admitUser("totp", invitationId);
    const accepted = await totp.request(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(accepted.status).toBe(200);

    const enable = await totp.request("POST", "/api/auth/two-factor/enable", {
      password: PASSWORD,
    });
    expect(enable.status).toBe(200);
    const enableBody = enable.json as {
      totpURI: string;
      backupCodes: string[];
    };
    const backupCode = enableBody.backupCodes[0];
    if (!backupCode)
      throw new Error("two-factor enable returned no backup codes");

    // Enable alone stays pending until the first TOTP verifies.
    const sessionAfterEnable = await totp.request(
      "GET",
      "/api/auth/get-session",
    );
    const enabledUser = (
      sessionAfterEnable.json as {
        user: { twoFactorEnabled?: boolean | null };
      }
    ).user;
    expect(enabledUser.twoFactorEnabled).not.toBe(true);

    // Only now may sign-in require the two-factor challenge.
    const secret = totpSecretFromUri(enableBody.totpURI);
    const firstVerify = await totp.request(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(secret) },
    );
    expect(firstVerify.status).toBe(200);
    const sessionAfterVerify = await totp.request(
      "GET",
      "/api/auth/get-session",
    );
    const verifiedUser = (
      sessionAfterVerify.json as {
        user: { twoFactorEnabled?: boolean | null };
      }
    ).user;
    expect(verifiedUser.twoFactorEnabled).toBe(true);

    const mfaUserId = await sqlUserId(totp.email);
    const mirrorId = crypto.randomUUID();
    await database.sql.query(
      `insert into session (id, token, user_id, expires_at) values ($1, $1, $2, now() + interval '1 day')`,
      [mirrorId, mfaUserId],
    );
    await database.sql.query(
      `update "user" set last_active_tenant_id = null where id = $1`,
      [mfaUserId],
    );
    await database.sql.query(
      `update session set active_organization_id = null where user_id = $1`,
      [mfaUserId],
    );
    const assertSelection = async (selected: string | null) => {
      const user = await database.sql.query<{
        last_active_tenant_id: string | null;
      }>(`select last_active_tenant_id from "user" where id = $1`, [mfaUserId]);
      expect(user.rows[0]?.last_active_tenant_id).toBe(selected);
      const mirrors = await database.sql.query<{
        active_organization_id: string | null;
      }>(`select active_organization_id from session where user_id = $1`, [
        mfaUserId,
      ]);
      expect(mirrors.rows.length).toBeGreaterThan(0);
      expect(
        mirrors.rows.every((row) => row.active_organization_id === selected),
      ).toBe(true);
    };
    const signOut = await totp.request("POST", "/api/auth/sign-out");
    expect(signOut.status).toBe(200);

    const pending = client();
    const challenged = await pending("POST", "/api/auth/sign-in/email", {
      email: userEmail("totp"),
      password: PASSWORD,
    });
    expect(challenged.status).toBe(200);
    expect(
      (challenged.json as { twoFactorRedirect?: boolean }).twoFactorRedirect,
    ).toBe(true);

    const pendingSession = await pending("GET", "/api/auth/get-session");
    expect(pendingSession.json).toBeNull();
    const pendingMe = await pending("GET", "/api/me/context");
    expect(pendingMe.status).toBe(401);
    expect(
      (await pending("POST", "/api/me/resolve-active-org", {})).status,
    ).toBe(401);
    await assertSelection(null);

    const wrongEndpoint = await pending(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: backupCode },
    );
    expect(wrongEndpoint.status).toBe(401);
    await assertSelection(null);
    const completed = await pending(
      "POST",
      "/api/auth/two-factor/verify-backup-code",
      { code: backupCode },
    );
    expect(completed.status).toBe(200);
    const sessionAfterChallenge = await pending("GET", "/api/auth/get-session");
    expect(sessionAfterChallenge.status).toBe(200);
    expect(
      (sessionAfterChallenge.json as { user: { id: string } }).user.id,
    ).toBeTruthy();

    await assertSelection(null);
    const resolvedBackup = await pending(
      "POST",
      "/api/me/resolve-active-org",
      {},
    );
    expect(resolvedBackup.status).toBe(200);
    expect(
      meContextResponseSchema.parse(resolvedBackup.json).lastActiveTenantId,
    ).toBe(ORG_ID);
    await assertSelection(ORG_ID);

    await pending("POST", "/api/auth/sign-out");
    await pending("POST", "/api/auth/sign-in/email", {
      email: userEmail("totp"),
      password: PASSWORD,
    });
    const replay = await pending(
      "POST",
      "/api/auth/two-factor/verify-backup-code",
      { code: backupCode },
    );
    expect(replay.status).toBe(401);
    await assertSelection(ORG_ID);

    const expired = client();
    await expired("POST", "/api/auth/sign-in/email", {
      email: totp.email,
      password: PASSWORD,
    });
    await database.sql.query(
      `update verification set expires_at = now() - interval '1 minute' where value = $1 and identifier like '2fa-%'`,
      [mfaUserId],
    );
    expect(
      (
        await expired("POST", "/api/auth/two-factor/verify-totp", {
          code: totpCode(secret),
        })
      ).status,
    ).toBe(401);
    expect(
      (await expired("POST", "/api/me/resolve-active-org", {})).status,
    ).toBe(401);
    await assertSelection(ORG_ID);

    const trusted = client();
    await trusted("POST", "/api/auth/sign-in/email", {
      email: totp.email,
      password: PASSWORD,
    });
    expect(
      (
        await trusted("POST", "/api/auth/two-factor/verify-totp", {
          code: totpCode(secret),
          trustDevice: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await trusted("POST", "/api/me/resolve-active-org", {})).status,
    ).toBe(200);
    await assertSelection(ORG_ID);
    await trusted("POST", "/api/auth/sign-out");
    const trustedLogin = await trusted("POST", "/api/auth/sign-in/email", {
      email: totp.email,
      password: PASSWORD,
    });
    expect(trustedLogin.status).toBe(200);
    expect(trustedLogin.json).not.toHaveProperty("twoFactorRedirect", true);
    expect(
      (await trusted("POST", "/api/me/resolve-active-org", {})).status,
    ).toBe(200);
    await assertSelection(ORG_ID);
  });
});

describe("MFA notification intent rollback", () => {
  it("preserves pending native MFA state when the verified-transition intent fails", async () => {
    const inviter = await database.sql.query<{ id: string }>(
      'select id from "user" where email = $1',
      [OWNER_INVITER_EMAIL],
    );
    const inviterId = inviter.rows[0]?.id;
    if (!inviterId) throw new Error("seeded inviter missing");
    const ownerInvitationId = crypto.randomUUID();
    await database.sql.query(
      `insert into invitation
         (id, organization_id, email, role, status, inviter_id, expires_at, created_at)
       values ($1, $2, $3, 'owner', 'pending', $4, now() + interval '2 days', now())`,
      [ownerInvitationId, ORG_ID, userEmail("mfa-owner"), inviterId],
    );
    const mfaOwner = await admitUser("mfa-owner", ownerInvitationId);
    const ownerAccepted = await mfaOwner.request(
      "POST",
      `/api/onboarding/invitations/${ownerInvitationId}/accept`,
    );
    expect(ownerAccepted.status).toBe(200);
    const active = await mfaOwner.request("PATCH", "/api/me/active-org", {
      organizationId: ORG_ID,
    });
    expect(active.status).toBe(200);
    const owner = mfaOwner.request;
    const invite = await owner(
      "POST",
      `/api/organizations/${ORG_ID}/invitations`,
      {
        email: userEmail("mfa-intent-failure"),
        role: "viewer",
      },
    );
    expect(invite.status).toBe(201);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("mfa-intent-failure"), "คำเชิญ").text,
    );
    const pending = await admitUser("mfa-intent-failure", invitationId);
    const accepted = await pending.request(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(accepted.status).toBe(200);
    const enabled = await pending.request(
      "POST",
      "/api/auth/two-factor/enable",
      {
        password: PASSWORD,
      },
    );
    expect(enabled.status).toBe(200);
    const { totpURI } = enabled.json as { totpURI: string };
    const userId = await sqlUserId(pending.email);
    const pendingProjection = await mfaProjectionEnabled(userId);
    expect(pendingProjection).toBe(false);
    const failingAuth = createAuth({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      database,
      mailer,
      originWriter: {
        insertPasswordChanged: () => Promise.resolve(),
        initializeMfaState: () => Promise.resolve(undefined),
        recordMfaTransition: () =>
          Promise.reject(new Error("forced MFA intent failure")),
      },
    });
    const failingApp = createApp({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      auth: failingAuth,
      mailer,
      database,
    });
    const request = client(failingApp, pending.request.cookies());

    const verify = await request("POST", "/api/auth/two-factor/verify-totp", {
      code: totpCode(totpSecretFromUri(totpURI)),
    });
    expect(verify.status).toBe(500);
    const user = await database.sql.query<{
      two_factor_enabled: boolean | null;
    }>('select two_factor_enabled from "user" where id = $1', [userId]);
    const directHeaders = new Headers({
      cookie: Object.entries(pending.request.cookies())
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    });
    await expect(
      failingAuth.api.verifyTOTP({
        body: { code: totpCode(totpSecretFromUri(totpURI)) },
        headers: directHeaders,
      }),
    ).rejects.toThrow("forced MFA intent failure");
    const twoFactor = await database.sql.query<{ verified: boolean }>(
      'select verified from "twoFactor" where user_id = $1',
      [userId],
    );

    expect(user.rows[0]?.two_factor_enabled).not.toBe(true);
    expect(twoFactor.rows[0]?.verified).toBe(false);
    expect(await mfaProjectionEnabled(userId)).toBe(pendingProjection);
    expect(await mfaIntentCount(userId)).toBe(0);
    const session = await request("GET", "/api/auth/get-session");
    const sessionBody = session.json as {
      user: { twoFactorEnabled?: boolean | null };
    };
    expect(sessionBody.user.twoFactorEnabled).not.toBe(true);

    const successfulVerify = await pending.request(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(totpSecretFromUri(totpURI)) },
    );
    expect(successfulVerify.status).toBe(200);
    const disableRequest = client(failingApp, pending.request.cookies());
    const disable = await disableRequest(
      "POST",
      "/api/auth/two-factor/disable",
      {
        password: PASSWORD,
      },
    );
    expect(disable.status).toBe(500);
    const enabledUser = await database.sql.query<{
      two_factor_enabled: boolean | null;
    }>('select two_factor_enabled from "user" where id = $1', [userId]);
    const enabledTwoFactor = await database.sql.query<{ verified: boolean }>(
      'select verified from "twoFactor" where user_id = $1',
      [userId],
    );
    expect(enabledUser.rows[0]?.two_factor_enabled).toBe(true);
    expect(enabledTwoFactor.rows[0]?.verified).toBe(true);
    expect(await mfaProjectionEnabled(userId)).toBe(true);
    expect(await mfaIntentCount(userId)).toBe(1);
    const sessionAfterDisableFailure = await disableRequest(
      "GET",
      "/api/auth/get-session",
    );
    const enabledSession = sessionAfterDisableFailure.json as {
      user: { twoFactorEnabled?: boolean | null };
    };
    expect(enabledSession.user.twoFactorEnabled).toBe(true);
    await disableRequest("POST", "/api/auth/sign-out");
    const challenged = await client()("POST", "/api/auth/sign-in/email", {
      email: pending.email,
      password: PASSWORD,
    });
    expect(
      (challenged.json as { twoFactorRedirect?: boolean }).twoFactorRedirect,
    ).toBe(true);
  });
});

describe("MFA re-enrollment atomicity", () => {
  it("preserves verified MFA when its replacement insert fails and keeps verified re-enrollment origin-free", async () => {
    const email = userEmail("mfa-reenrollment");
    mfaReenrollmentFixtureEmails.push(email);
    const invitationId = await createInvitation(email);
    const member = await admitUser("mfa-reenrollment", invitationId);
    const accepted = await member.request(
      "POST",
      `/api/onboarding/invitations/${invitationId}/accept`,
    );
    expect(accepted.status).toBe(200);
    const initialEnable = await member.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: PASSWORD },
    );
    expect(initialEnable.status).toBe(200);
    const initialSecret = totpSecretFromUri(
      (initialEnable.json as { totpURI: string }).totpURI,
    );
    const initialVerify = await member.request(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(initialSecret) },
    );
    expect(initialVerify.status).toBe(200);

    const userId = await sqlUserId(email);
    const before = await ownerDatabase.sql.query<{
      id: string;
      two_factor_enabled: boolean | null;
      verified: boolean;
    }>(
      `select tf.id, u.two_factor_enabled, tf.verified
       from "user" as u
       join "twoFactor" as tf on tf.user_id = u.id
       where u.id = $1`,
      [userId],
    );
    const oldRow = before.rows[0];
    if (!oldRow) throw new Error("verified MFA fixture missing");
    const intentCount = await mfaIntentCount(userId);
    expect(oldRow).toMatchObject({
      two_factor_enabled: true,
      verified: true,
    });
    expect(await mfaProjectionEnabled(userId)).toBe(true);
    expect(intentCount).toBe(1);

    let triggerCreated = false;
    try {
      await ownerDatabase.sql.query(
        `create function ${MFA_REENROLL_TRIGGER}() returns trigger
         language plpgsql as $$
         begin
           if new.user_id = '${userId}' then
             raise exception 'fixture rejects replacement two-factor row';
           end if;
           return new;
         end;
         $$`,
      );
      await ownerDatabase.sql.query(
        `create trigger ${MFA_REENROLL_TRIGGER}
         before insert on "twoFactor"
         for each row execute function ${MFA_REENROLL_TRIGGER}()`,
      );
      triggerCreated = true;

      const failed = await member.request(
        "POST",
        "/api/auth/two-factor/enable",
        { password: PASSWORD },
      );
      expect(failed.status).toBe(500);
      const afterFailed = await ownerDatabase.sql.query<{
        id: string;
        two_factor_enabled: boolean | null;
        verified: boolean;
      }>(
        `select tf.id, u.two_factor_enabled, tf.verified
         from "user" as u
         join "twoFactor" as tf on tf.user_id = u.id
         where u.id = $1`,
        [userId],
      );
      expect(afterFailed.rows[0]).toEqual(oldRow);
      expect(await mfaProjectionEnabled(userId)).toBe(true);
      expect(await mfaIntentCount(userId)).toBe(intentCount);
    } finally {
      if (triggerCreated) {
        await ownerDatabase.sql.query(
          `drop trigger ${MFA_REENROLL_TRIGGER} on "twoFactor"`,
        );
      }
      await ownerDatabase.sql.query(
        `drop function if exists ${MFA_REENROLL_TRIGGER}()`,
      );
    }

    // A missing projection models a legacy verified credential; re-enrollment
    // must not invent MFA_ENABLED.
    await ownerDatabase.sql.query(
      "delete from notification_account_mfa_state where user_id = $1",
      [userId],
    );
    const directAuth = createAuth({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),

      database,
      mailer,
    });
    await directAuth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: sessionHeaders(member.request),
    });
    const afterReenrollment = await database.sql.query<{
      id: string;
      two_factor_enabled: boolean | null;
      verified: boolean;
    }>(
      `select tf.id, u.two_factor_enabled, tf.verified
       from "user" as u
       join "twoFactor" as tf on tf.user_id = u.id
       where u.id = $1`,
      [userId],
    );
    expect(afterReenrollment.rows[0]).toMatchObject({
      two_factor_enabled: true,
      verified: true,
    });
    expect(afterReenrollment.rows[0]?.id).not.toBe(oldRow.id);
    expect(await mfaProjectionEnabled(userId)).toBe(true);
    expect(await mfaIntentCount(userId)).toBe(intentCount);

    await ownerDatabase.sql.query(
      "delete from notification_account_mfa_state where user_id = $1",
      [userId],
    );
    const legacyDisable = await member.request(
      "POST",
      "/api/auth/two-factor/disable",
      { password: PASSWORD },
    );
    expect(legacyDisable.status).toBe(200);
    expect(await mfaProjectionEnabled(userId)).toBe(false);
    expect(await mfaIntentCount(userId)).toBe(intentCount + 1);
    expect(
      (
        await ownerDatabase.sql.query<{
          two_factor_enabled: boolean | null;
          two_factor_count: number;
        }>(
          `select u.two_factor_enabled,
                  (select count(*)::integer from "twoFactor" where user_id = u.id) as two_factor_count
           from "user" as u
           where u.id = $1`,
          [userId],
        )
      ).rows,
    ).toEqual([{ two_factor_enabled: false, two_factor_count: 0 }]);
    expect(
      (
        await ownerDatabase.sql.query<{ event_type: string }>(
          `select event_type from notification_intents
           where user_id = $1
           order by created_at desc
           limit 1`,
          [userId],
        )
      ).rows,
    ).toEqual([{ event_type: "MFA_DISABLED" }]);

    const repeatedDisable = await member.request(
      "POST",
      "/api/auth/two-factor/disable",
      { password: PASSWORD },
    );
    expect(repeatedDisable.status).toBe(200);
    expect(await mfaIntentCount(userId)).toBe(intentCount + 1);

    await member.request("POST", "/api/auth/sign-out");
    const challenged = await client()("POST", "/api/auth/sign-in/email", {
      email,
      password: PASSWORD,
    });
    expect(
      (challenged.json as { twoFactorRedirect?: boolean }).twoFactorRedirect,
    ).not.toBe(true);
  });
});

describe("native organization membership mutation guard", () => {
  it("rejects direct native member mutations without touching membership mirrors or notification state", async () => {
    const organizationId = crypto.randomUUID();
    const ownerEmail = userEmail("member-guard-owner");
    const targetEmail = userEmail("member-guard-target");
    const leaverEmail = userEmail("member-guard-leaver");
    memberGuardFixtureEmails.push(ownerEmail, targetEmail, leaverEmail);
    memberGuardOrganizationIds.push(organizationId);
    await database.sql.query(
      "insert into organization (id, name, slug, created_at) values ($1, $2, $3, now())",
      [organizationId, `Member Guard ${RUN}`, `member-guard-${RUN}`],
    );
    const [ownerInvitationId, targetInvitationId, leaverInvitationId] =
      await Promise.all([
        createInvitation(ownerEmail, "viewer", organizationId),
        createInvitation(targetEmail, "viewer", organizationId),
        createInvitation(leaverEmail, "viewer", organizationId),
      ]);
    const [owner, target, leaver] = await Promise.all([
      admitUser("member-guard-owner", ownerInvitationId),
      admitUser("member-guard-target", targetInvitationId),
      admitUser("member-guard-leaver", leaverInvitationId),
    ]);
    const [ownerId, targetId, leaverId] = await Promise.all([
      sqlUserId(owner.email),
      sqlUserId(target.email),
      sqlUserId(leaver.email),
    ]);
    const [ownerMemberId, targetMemberId, leaverMemberId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await database.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now()),
              ($4, $2, $5, 'viewer', now(), now()),
              ($6, $2, $7, 'viewer', now(), now())`,
      [
        ownerMemberId,
        organizationId,
        ownerId,
        targetMemberId,
        targetId,
        leaverMemberId,
        leaverId,
      ],
    );
    await database.sql.query(
      'update "user" set last_active_tenant_id = $1 where id = any($2::text[])',
      [organizationId, [targetId, leaverId]],
    );
    await database.sql.query(
      "update session set active_organization_id = $1 where user_id = any($2::text[])",
      [organizationId, [targetId, leaverId]],
    );

    const directAuth = createAuth({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      database,
      mailer,
    });
    const before = await memberMutationSnapshot(
      organizationId,
      ownerId,
      targetMemberId,
      targetId,
      leaverId,
    );
    expect(before).toMatchObject({
      targetRole: "viewer",
      targetMembership: 1,
      leaverMembership: 1,
      targetLastActiveOrganizationId: organizationId,
      leaverLastActiveOrganizationId: organizationId,
    });
    expect(before.targetActiveOrganizationSessions).toBeGreaterThan(0);
    expect(before.leaverActiveOrganizationSessions).toBeGreaterThan(0);
    const ownerHeaders = sessionHeaders(owner.request);
    ownerHeaders.set("content-type", "application/json");
    const leaverHeaders = sessionHeaders(leaver.request);
    leaverHeaders.set("content-type", "application/json");

    const directResponses = await Promise.all([
      directAuth.handler(
        new Request(
          `${authEnv.BETTER_AUTH_URL}/api/auth/organization/update-member-role`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({
              organizationId,
              memberId: targetMemberId,
              role: "admin",
            }),
          },
        ),
      ),
      directAuth.handler(
        new Request(
          `${authEnv.BETTER_AUTH_URL}/api/auth/organization/remove-member`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({
              organizationId,
              memberIdOrEmail: targetMemberId,
            }),
          },
        ),
      ),
      directAuth.handler(
        new Request(`${authEnv.BETTER_AUTH_URL}/api/auth/organization/leave`, {
          method: "POST",
          headers: leaverHeaders,
          body: JSON.stringify({ organizationId }),
        }),
      ),
    ]);
    for (const response of directResponses) {
      expect(response.status).toBe(403);
    }
    expect(
      await memberMutationSnapshot(
        organizationId,
        ownerId,
        targetMemberId,
        targetId,
        leaverId,
      ),
    ).toEqual(before);
    // Role PATCH, revoke, leave and the LAST_OWNER guard through the
    // first-party routes are covered by organization-notifications/routes.db.test.ts
    // ("organization member HTTP mutations", "organization member revoke HTTP
    // contract", "organization member self-leave HTTP contract").
  }, 120_000);

  it("denies the 9 hotfix paths in the Better Auth hook when the first-layer guard is bypassed", async () => {
    const organizationId = crypto.randomUUID();
    const ownerEmail = userEmail("native-hook-owner");
    memberGuardFixtureEmails.push(ownerEmail);
    memberGuardOrganizationIds.push(organizationId);
    await database.sql.query(
      "insert into organization (id, name, slug, created_at) values ($1, $2, $3, now())",
      [organizationId, `Native Hook ${RUN}`, `native-hook-${RUN}`],
    );
    const ownerInvitationId = await createInvitation(
      ownerEmail,
      "viewer",
      organizationId,
    );
    const owner = await admitUser("native-hook-owner", ownerInvitationId);
    const ownerId = await sqlUserId(owner.email);
    await database.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now())`,
      [crypto.randomUUID(), organizationId, ownerId],
    );
    const pendingId = await createInvitation(
      userEmail("native-hook-invitee"),
      "owner",
      organizationId,
    );
    const directAuth = createAuth({
      env,
      authEnv,
      logger: createLogger({ level: "silent", name: "auth-it" }),
      database,
      mailer,
    });
    const headers = sessionHeaders(owner.request);
    headers.set("content-type", "application/json");
    const nativeEndpoints = [
      ["GET", "list-invitations"],
      ["GET", "get-full-organization"],
      ["POST", "cancel-invitation"],
      ["GET", "get-invitation"],
      ["POST", "reject-invitation"],
      ["GET", "list-user-invitations"],
      ["GET", "list-members"],
      ["GET", "get-active-member-role"],
      ["POST", "delete"],
    ] as const;
    for (const [method, endpoint] of nativeEndpoints) {
      const query = `?organizationId=${organizationId}&id=${pendingId}`;
      const response = await directAuth.handler(
        new Request(
          `${authEnv.BETTER_AUTH_URL}/api/auth/organization/${endpoint}${
            method === "GET" ? query : ""
          }`,
          {
            method,
            headers,
            body:
              method === "POST"
                ? JSON.stringify({ organizationId, invitationId: pendingId })
                : undefined,
          },
        ),
      );
      // Native get-invitation and reject-invitation also answer 403 on their
      // own, so only the hook's body proves the path is in the blocked set.
      expect({
        endpoint,
        status: response.status,
        body: await response.json(),
      }).toMatchObject({
        endpoint,
        status: 403,
        body: { message: "ใช้เส้นทางจัดการสมาชิกใหม่" },
      });
    }
    const state = await database.sql.query<{ status: string; orgs: number }>(
      `select i.status,
              (select count(*)::int from organization where id = $2) as orgs
         from invitation i where i.id = $1`,
      [pendingId, organizationId],
    );
    expect(state.rows).toEqual([{ status: "pending", orgs: 1 }]);
  }, 120_000);
});
describe("duplicate-account signup stays enumeration-safe and harmless", () => {
  it("answers the generic success without touching the existing account", async () => {
    const invitations = await database.sql.query<{ id: string }>(
      "select id from invitation where organization_id = $1 and email = $2 and status = 'pending' order by created_at",
      [ORG_ID, userEmail("dup")],
    );
    const [first, second] = invitations.rows;
    if (!first || !second)
      throw new Error("seeded duplicate invitations missing");

    await admitUser("dup", first.id);

    // requireEmailVerification makes a duplicate signup an enumeration-safe
    // generic success: no session or second user row.
    const attackerPassword = "Auth-It-DupPassw0rd!";
    const duplicate = await client()(
      "POST",
      "/api/auth/sign-up/email",
      {
        name: "Duplicate Dup",
        email: userEmail("dup"),
        password: attackerPassword,
        callbackURL: `/onboarding?invitationId=${second.id}`,
      },
      { invitationId: second.id },
    );
    expect(duplicate.status).toBe(200);
    expect((duplicate.json as { token?: string | null }).token).toBeNull();
    const users = await database.sql.query<{ n: number }>(
      'select count(*)::int as n from "user" where email = $1',
      [userEmail("dup")],
    );
    expect(users.rows[0]?.n).toBe(1);

    // The duplicate attempt's password never lands.
    const original = await client()("POST", "/api/auth/sign-in/email", {
      email: userEmail("dup"),
      password: PASSWORD,
    });
    expect(original.status).toBe(200);
    const overwritten = await client()("POST", "/api/auth/sign-in/email", {
      email: userEmail("dup"),
      password: attackerPassword,
    });
    expect(overwritten.status).toBe(401);
  });
});

describe("locked invitation acceptance at the member cap", () => {
  it("serializes two recipients at 999 and keeps the capped invitation pending", async () => {
    const organizationId = crypto.randomUUID();
    const prefix = `cap-${RUN}-`;
    const firstEmail = userEmail("cap-first");
    const secondEmail = userEmail("cap-second");
    await database.sql.query(
      "insert into organization (id, name, slug, created_at) values ($1, 'Cap IT Org', $2, now())",
      [organizationId, `cap-${RUN}`],
    );
    try {
      const firstInvitation = await createInvitation(
        firstEmail,
        "owner",
        organizationId,
      );
      const secondInvitation = await createInvitation(
        secondEmail,
        "owner",
        organizationId,
      );
      const [first, second] = await Promise.all([
        admitUser("cap-first", firstInvitation),
        admitUser("cap-second", secondInvitation),
      ]);
      const firstId = await sqlUserId(firstEmail);
      const secondId = await sqlUserId(secondEmail);
      await database.sql.query(
        `insert into "user" (id, name, email, created_at)
         select $1 || n::text, 'Cap fixture', $1 || n::text || '@example.test', now()
         from generate_series(1, 999) as n`,
        [prefix],
      );
      await database.sql.query(
        `insert into member (id, organization_id, user_id, role, created_at)
         select $1 || n::text, $2, $1 || n::text, 'viewer', now()
         from generate_series(1, 999) as n`,
        [prefix, organizationId],
      );
      const count = async () => {
        const result = await database.sql.query<{ total: number }>(
          "select count(*)::int as total from member where organization_id = $1",
          [organizationId],
        );
        return result.rows[0]?.total;
      };
      expect(await count()).toBe(999);
      expect(await membershipCount(organizationId, firstId)).toBe(0);
      const before = await first.request("GET", "/api/me/context");
      expect(meContextResponseSchema.parse(before.json).organizations).toEqual(
        [],
      );
      const deniedBefore = await first.request("PATCH", "/api/me/active-org", {
        organizationId,
      });
      expect(deniedBefore.status).toBe(403);
      const listPath = `/api/organizations/${organizationId}/members?limit=50&offset=999`;
      const protectedBefore = await first.request("GET", listPath);
      expect(protectedBefore).toEqual({
        status: 403,
        json: {
          error: {
            code: "MEMBERSHIP_DENIED",
            message: "คุณไม่ใช่สมาชิกขององค์กรนี้",
          },
        },
      });
      expect(await second.request("GET", listPath)).toEqual(protectedBefore);
      const native = await first.request(
        "POST",
        "/api/auth/organization/accept-invitation",
        { invitationId: firstInvitation },
      );
      expect(native.status).toBe(403);
      expect(await count()).toBe(999);
      const missing = await first.request(
        "POST",
        `/api/onboarding/invitations/${crypto.randomUUID()}/accept`,
      );
      const expired = await first.request(
        "POST",
        `/api/onboarding/invitations/${EXPIRED_INVITATION_ID}/accept`,
      );
      const wrongRecipient = await first.request(
        "POST",
        `/api/onboarding/invitations/${secondInvitation}/accept`,
      );
      expect(missing).toEqual(expired);
      expect(expired).toEqual(wrongRecipient);
      expect(missing.json).toMatchObject({
        error: { code: "INVITATION_NOT_FOUND" },
      });
      const holder = await database.sql.connect();
      let held = false;
      let accepts: Promise<ApiResponse[]> | undefined;
      let outcomes: ApiResponse[];
      try {
        await holder.query("begin");
        held = true;
        const lock = await holder.query<{ pid: number }>(
          "select pg_backend_pid() as pid from organization where id = $1 for update",
          [organizationId],
        );
        const pid = lock.rows[0]?.pid;
        if (pid === undefined) throw new Error("organization lock missing");
        accepts = Promise.all([
          first.request(
            "POST",
            `/api/onboarding/invitations/${firstInvitation}/accept`,
          ),
          second.request(
            "POST",
            `/api/onboarding/invitations/${secondInvitation}/accept`,
          ),
        ]);
        const deadline = Date.now() + 10_000;
        let waiting = 0;
        while (waiting < 2 && Date.now() < deadline) {
          const blocked = await database.sql.query<{ total: number }>(
            `with recursive blocked_by(pid) as (
               select $1::int
               union
               select activity.pid from pg_stat_activity activity
               join blocked_by blocker on blocker.pid = any(pg_blocking_pids(activity.pid))
             )
             select count(*)::int as total from blocked_by where pid <> $1`,
            [pid],
          );
          waiting = blocked.rows[0]?.total ?? 0;
        }
        expect(waiting).toBe(2);
        await holder.query("commit");
        held = false;
        outcomes = await accepts;
      } finally {
        if (held) await holder.query("rollback");
        holder.release();
        await accepts?.catch(() => undefined);
      }
      expect(outcomes.map((result) => result.status).sort()).toEqual([
        200, 409,
      ]);
      expect(
        outcomes.find((result) => result.status === 409)?.json,
      ).toMatchObject({
        error: { code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED" },
      });
      expect(await count()).toBe(1000);
      const winner = outcomes[0]?.status === 200 ? first : second;
      const loser = outcomes[0]?.status === 409 ? first : second;
      const winnerInvitation =
        winner === first ? firstInvitation : secondInvitation;
      const loserInvitation =
        loser === first ? firstInvitation : secondInvitation;
      expect(await invitationStatus(winnerInvitation)).toBe("accepted");
      expect(await invitationStatus(loserInvitation)).toBe("pending");
      expect(
        await membershipCount(
          organizationId,
          winner === first ? firstId : secondId,
        ),
      ).toBe(1);
      expect(
        await membershipCount(
          organizationId,
          loser === first ? firstId : secondId,
        ),
      ).toBe(0);
      const winnerContext = await winner.request("GET", "/api/me/context");
      expect(
        meContextResponseSchema.parse(winnerContext.json).organizations,
      ).toMatchObject([{ id: organizationId, role: "owner" }]);
      const loserContext = await loser.request("GET", "/api/me/context");
      expect(
        meContextResponseSchema.parse(loserContext.json).organizations,
      ).toEqual([]);
      const protectedAfter = await winner.request("GET", listPath);
      expect(protectedAfter.status).toBe(200);
      expect(protectedAfter.json).toMatchObject({
        organizationId,
        page: { limit: 50, offset: 999, total: 1000 },
        members: [
          {
            userId: winner === first ? firstId : secondId,
            email: winner === first ? firstEmail : secondEmail,
            role: "owner",
          },
        ],
      });
      expect(await loser.request("GET", listPath)).toEqual(protectedBefore);
      const selected = await winner.request("PATCH", "/api/me/active-org", {
        organizationId,
      });
      expect(selected.status).toBe(200);
      const denied = await loser.request("PATCH", "/api/me/active-org", {
        organizationId,
      });
      expect(denied.status).toBe(403);
      const replay = await winner.request(
        "POST",
        `/api/onboarding/invitations/${winnerInvitation}/accept`,
      );
      expect(replay).toEqual(missing);
    } finally {
      await database.sql.query("delete from organization where id = $1", [
        organizationId,
      ]);
      await database.sql.query(
        'delete from "user" where email = any($1::text[]) or email like $2',
        [[firstEmail, secondEmail], `${prefix}%@example.test`],
      );
    }
  }, 120_000);
  it("keeps acceptance denials identical across invitation states in response and logs", async () => {
    const email = userEmail("accept-privacy");
    const ownInvitation = await createInvitation(email);
    const otherEmail = userEmail("accept-other");
    const wrongRecipient = await createInvitation(otherEmail);
    const nonPending = await createInvitation(email);
    const recipient = await admitUser("accept-privacy", ownInvitation);
    const userId = await sqlUserId(email);
    const verificationToken = linkQuery(
      findMail(email, "ยืนยันอีเมล").text,
      "emailVerificationToken",
    );
    const unknown = crypto.randomUUID();
    await database.sql.query(
      "update invitation set status = 'canceled' where id = $1",
      [nonPending],
    );
    const logs: string[] = [];
    const logger = createLogger(
      { level: "info", name: "accept-privacy" },
      { write: (line: string) => void logs.push(line) },
    );
    const loggedApp = createApp({
      env,
      authEnv,
      logger,
      auth: createAuth({ env, authEnv, logger, database, mailer }),
      database,
      mailer,
    });
    const request = client(loggedApp, recipient.request.cookies());
    const attempt = async (invitationId: string) => {
      logs.length = 0;
      const response = await request(
        "POST",
        `/api/onboarding/invitations/${invitationId}/accept`,
      );
      const entries = logs.map(
        (line) => JSON.parse(line) as Record<string, unknown>,
      );
      const errors = entries.filter((entry) => entry.msg === "request failed");
      const completions = entries.filter(
        (entry) => entry.msg === "request completed",
      );
      expect(errors).toHaveLength(1);
      expect(completions).toHaveLength(1);
      expect(
        entries.filter((entry) => entry.msg === "organization access denied"),
      ).toEqual([]);
      for (const sensitive of [
        email,
        otherEmail,
        unknown,
        EXPIRED_INVITATION_ID,
        wrongRecipient,
        nonPending,
        ownInvitation,
        verificationToken,
        ORG_ID,
      ]) {
        expect(JSON.stringify(entries)).not.toContain(sensitive);
        expect(JSON.stringify(response)).not.toContain(sensitive);
      }
      return {
        response,
        error: {
          code: errors[0]?.code,
          message: errors[0]?.msg,
          err: errors[0]?.err,
        },
        completion: {
          method: completions[0]?.method,
          path: completions[0]?.path,
          status: completions[0]?.status,
          message: completions[0]?.msg,
        },
      };
    };
    try {
      const missing = await attempt(unknown);
      expect(missing.response).toEqual({
        status: 404,
        json: {
          error: {
            code: "INVITATION_NOT_FOUND",
            message: "ไม่พบคำเชิญ หรือคำเชิญหมดอายุแล้ว",
          },
        },
      });
      for (const id of [EXPIRED_INVITATION_ID, nonPending, wrongRecipient]) {
        expect(await attempt(id)).toEqual(missing);
      }
      expect(missing.error).toEqual({
        code: "INVITATION_NOT_FOUND",
        message: "request failed",
        err: undefined,
      });
      expect(missing.completion).toEqual({
        method: "POST",
        path: "/api/onboarding/invitations/:invitationId/accept",
        status: 404,
        message: "request completed",
      });
      logs.length = 0;
      const native = await request(
        "POST",
        "/api/auth/organization/accept-invitation",
        { invitationId: ownInvitation },
      );
      expect(native).toEqual({
        status: 403,
        json: {
          error: {
            code: "PERMISSION_DENIED",
            message: "ใช้เส้นทางจัดการสมาชิกใหม่",
          },
        },
      });
      const nativeLogs = logs.map(
        (line) => JSON.parse(line) as Record<string, unknown>,
      );
      expect(
        nativeLogs.filter(
          (entry) => entry.msg === "organization access denied",
        ),
      ).toMatchObject([
        {
          actorUserId: userId,
          action: "legacy:/api/auth/organization/accept-invitation",
          code: "PERMISSION_DENIED",
        },
      ]);
      expect(
        nativeLogs.filter((entry) => entry.msg === "request completed"),
      ).toMatchObject([
        {
          method: "POST",
          path: "/api/auth/organization/accept-invitation",
          status: 403,
        },
      ]);
      for (const sensitive of [
        email,
        otherEmail,
        ownInvitation,
        verificationToken,
        ORG_ID,
      ]) {
        expect(JSON.stringify(nativeLogs)).not.toContain(sensitive);
        expect(JSON.stringify(native)).not.toContain(sensitive);
      }
      expect(await membershipCount(ORG_ID, userId)).toBe(0);
      expect(await invitationStatus(ownInvitation)).toBe("pending");
      expect(await invitationStatus(nonPending)).toBe("canceled");
      expect(await invitationStatus(wrongRecipient)).toBe("pending");
      expect(await invitationStatus(EXPIRED_INVITATION_ID)).toBe("pending");
      expect(await invitationStatus(unknown)).toBeNull();
    } finally {
      await database.sql.query(
        "delete from invitation where id = any($1::text[])",
        [[ownInvitation, wrongRecipient, nonPending]],
      );
      await database.sql.query('delete from "user" where id = $1', [userId]);
    }
  });
});

describe("acceptance rollback after the member insert", () => {
  it("leaves both the invitation and membership unchanged when the claim fails", async () => {
    const email = userEmail("accept-rollback");
    const invitationId = await createInvitation(email);
    const recipient = await admitUser("accept-rollback", invitationId);
    const userId = await sqlUserId(email);
    const trigger = `accept_rollback_${RUN}`;
    await ownerDatabase.sql.query(
      `create function ${trigger}() returns trigger language plpgsql as $$
       begin
         if old.id = '${invitationId}' then
           raise exception 'acceptance rollback fixture';
         end if;
         return new;
       end $$`,
    );
    try {
      await ownerDatabase.sql.query(
        `create trigger ${trigger} before update on invitation
         for each row execute function ${trigger}()`,
      );
      let output = "";
      const logger = createLogger(
        { level: "info", name: "accept-rollback" },
        {
          write: (chunk: string) => {
            output += chunk;
          },
        },
      );
      const loggedApp = createApp({
        env,
        authEnv,
        logger,
        auth: createAuth({ env, authEnv, logger, database, mailer }),
        database,
        mailer,
      });
      const response = await client(loggedApp, recipient.request.cookies())(
        "POST",
        `/api/onboarding/invitations/${invitationId}/accept`,
      );
      expect(response).toEqual({
        status: 500,
        json: {
          error: { code: "INTERNAL_ERROR", message: "Internal server error" },
        },
      });
      expect(output).toContain(
        '"path":"/api/onboarding/invitations/:invitationId/accept"',
      );
      expect(output).not.toContain(invitationId);
      expect(output).not.toContain(email);
      expect(output).not.toContain("acceptance rollback fixture");
      expect(await invitationStatus(invitationId)).toBe("pending");
      expect(await membershipCount(ORG_ID, userId)).toBe(0);
      const context = await recipient.request("GET", "/api/me/context");
      expect(meContextResponseSchema.parse(context.json).organizations).toEqual(
        [],
      );
    } finally {
      await ownerDatabase.sql.query(
        `drop trigger if exists ${trigger} on invitation`,
      );
      await ownerDatabase.sql.query(`drop function if exists ${trigger}()`);
      await database.sql.query("delete from invitation where id = $1", [
        invitationId,
      ]);
      await database.sql.query('delete from "user" where id = $1', [userId]);
    }
  });
});

describe("acceptance rechecks after waiting for the organization", () => {
  it("denies an invitation expired while its accept waits", async () => {
    const email = userEmail("accept-expiry-wait");
    const invitationId = await createInvitation(email);
    const recipient = await admitUser("accept-expiry-wait", invitationId);
    const userId = await sqlUserId(email);
    const holder = await database.sql.connect();
    let held = false;
    let request: Promise<ApiResponse> | undefined;
    try {
      await holder.query("begin");
      held = true;
      const lock = await holder.query<{ pid: number }>(
        "select pg_backend_pid() as pid from organization where id = $1 for update",
        [ORG_ID],
      );
      const pid = lock.rows[0]?.pid;
      if (pid === undefined) throw new Error("organization lock missing");
      request = recipient.request(
        "POST",
        `/api/onboarding/invitations/${invitationId}/accept`,
      );
      const deadline = Date.now() + 10_000;
      let blocked = 0;
      while (blocked === 0 && Date.now() < deadline) {
        const result = await database.sql.query<{ total: number }>(
          "select count(*)::int as total from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
          [pid],
        );
        blocked = result.rows[0]?.total ?? 0;
      }
      expect(blocked).toBe(1);
      await database.sql.query(
        "update invitation set expires_at = now() - interval '1 second' where id = $1",
        [invitationId],
      );
      await holder.query("commit");
      held = false;
      const result = await request;
      expect(result).toMatchObject({
        status: 404,
        json: { error: { code: "INVITATION_NOT_FOUND" } },
      });
      expect(await invitationStatus(invitationId)).toBe("pending");
      expect(await membershipCount(ORG_ID, userId)).toBe(0);
    } finally {
      if (held) await holder.query("rollback");
      holder.release();
      await request?.catch(() => undefined);
      await database.sql.query("delete from invitation where id = $1", [
        invitationId,
      ]);
      await database.sql.query('delete from "user" where id = $1', [userId]);
    }
  });
});
