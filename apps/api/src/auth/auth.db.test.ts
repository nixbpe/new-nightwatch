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
/**
 * Real database integration for the auth boundary (QA-8/QA-9, SEC-005).
 * Runs only under the explicit `integration` project
 * (`bun run test:integration`) against a dedicated test database; the unit
 * project never touches a database.
 *
 * Environment contract (see src/testing/db-integration.ts):
 * - DATABASE_URL — runtime-role test database (required; refusal, no skip)
 * - DATABASE_OWNER_URL — owner role, used to apply migrations (required;
 *   never falls back to the runtime role)
 * - MIGRATIONS_DIR — optional override; defaults to the repo's
 *   packages/db/migrations resolved from this file
 *
 * Coverage intent: exercise the real factory and native endpoints for the
 * invitation-gated signup, verification continuation, explicit acceptance,
 * the concurrent-acceptance membership race (exactly one membership, zero
 * 5xx), password recovery and the TOTP challenge/session boundary. No
 * hooks/copy/forwarded-argument pinning — every assertion is an observable
 * HTTP or SQL outcome. The unrelated-failure negative provokes its error
 * on a dedicated read-only connection (per-session
 * default_transaction_read_only), never by mutating shared grants.
 */

// Both URLs are required before any database work — no owner fallback
// (CONFIG-001). The refusal throws at module load, so a misconfigured run
// fails loudly instead of silently skipping or borrowing runtime grants.
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

// The pool is created at module scope but connects lazily on first query;
// beforeAll applies migrations and seeds before any test touches it.
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
  /**
   * Pending invitation admitting an intentional raw signup, sent as the
   * `X-Invitation-ID` header exactly the way the onboarding UI sends it.
   * Negative fixtures omit it (or pass an unknown/expired id) to prove the
   * gate stays fail-closed.
   */
  invitationId?: string;
};

type ApiResponse = { status: number; json: unknown };

type ApiRequest = ((
  method: "DELETE" | "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
  options?: ApiRequestOptions,
) => Promise<ApiResponse>) & {
  /** Snapshot of the current cookie jar (for carrying a session across apps). */
  cookies: () => Record<string, string>;
};

/** HTTP client with a cookie jar and the trusted SPA origin on writes. */
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

/** Invitation id parsed from the accept link in the invitation mail text. */
function invitationIdFromMail(mailText: string): string {
  const link = /https?:\/\/[^\s<>'"]+/.exec(mailText)?.[0];
  if (!link) throw new Error("no link in invitation mail");
  const id = /\/accept-invitation\/([^/]+)/.exec(new URL(link).pathname)?.[1];
  if (!id) throw new Error("no invitation id in invitation mail link");
  return decodeURIComponent(id);
}

// --- TOTP (RFC 6238, SHA-1, 6 digits, 30 s step) -----------------------
// The real algorithm an authenticator app runs, so enrollment and
// challenge exercise the native two-factor endpoints end to end. The
// secret is never logged.
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

/**
 * Full admission path: invitation-gated signup, captured verification mail,
 * token verification, sign-in with a verified session. Returns the email
 * and the cookie-bound client that holds the verified session.
 */
async function admitUser(
  local: string,
  invitationId: string,
): Promise<{ email: string; request: ApiRequest }> {
  const request = client();
  const email = userEmail(local);
  // Intentional valid signup: presents the pending invitation id in the
  // X-Invitation-ID header, as the onboarding UI does (SEC-C2-TEST-001).
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

/**
 * Sign in as the admitted gate owner and select the seeded organization as
 * active — the same PATCH /api/me/active-org path the workspace UI drives
 * before org-scoped Better Auth APIs (invite-member resolves the session's
 * active organization when no explicit organizationId is passed).
 */
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
  // Migrations are owner work and require the explicit owner URL — never a
  // runtime-role fallback (CONFIG-001).
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
  // Two pending invitations for the same mailbox drive the duplicate-signup
  // negative: the first signup creates the account, the second must surface
  // the native duplicate-account conflict (never the invitation denial).
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
  // Expired pending invitation: presenting its header must still be denied
  // by the signup gate, exactly like a missing or unknown one.
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
  // The fail-closed contract: every denial returns the same generic Thai
  // message, so the response never distinguishes missing, unknown or
  // expired invitations, and no user row is written.
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

    // Intentional valid signup: the pending invitation id rides the
    // X-Invitation-ID header, as the onboarding UI sends it.
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
      "/api/auth/organization/accept-invitation",
      {
        invitationId,
      },
    );
    expect(accept.status).toBe(200);
    expect(await invitationStatus(invitationId)).toBe("accepted");
    const userId = await sqlUserId(userEmail("gate"));
    expect(await membershipCount(ORG_ID, userId)).toBe(1);

    // A replayed acceptance now receives the same deterministic native
    // denial as every non-winning concurrent request.
    const replay = await gate(
      "POST",
      "/api/auth/organization/accept-invitation",
      {
        invitationId,
      },
    );
    expect(replay.status).toBe(400);
  });
});

describe("concurrent acceptance race (QA-9 / SEC-005)", () => {
  it("accepts once under concurrency and cannot restore membership after owner removal", async () => {
    const owner = await signInOwner();
    const invite = await owner("POST", "/api/auth/organization/invite-member", {
      email: userEmail("race"),
      role: "viewer",
    });
    expect(invite.status).toBe(200);

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
          raceUser.request("POST", "/api/auth/organization/accept-invitation", {
            invitationId,
          }),
        ),
      );
      // Include indirect blockers: later row-lock waiters can queue behind
      // another accept, rather than directly behind this transaction.
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
        // On a barrier failure, settle requests only after releasing their
        // blocker so no in-flight fixture work leaks into another test.
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
    expect(results.filter((result) => result.status === 400)).toHaveLength(3);
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

    // Denial must come from the consumed invitation, not its expiry or an
    // existing membership: this is the same still-live invitation id.
    const invitation = await database.sql.query<{ unexpired: boolean }>(
      "select expires_at > now() as unexpired from invitation where id = $1",
      [invitationId],
    );
    expect(invitation.rows[0]?.unexpired).toBe(true);
    const replay = await raceUser.request(
      "POST",
      "/api/auth/organization/accept-invitation",
      { invitationId },
    );
    expect(replay.status).toBe(400);
    expect(await invitationStatus(invitationId)).toBe("accepted");
    expect(await membershipCount(ORG_ID, userId)).toBe(0);
    const replayContext = await raceUser.request("GET", "/api/me/context");
    expect(replayContext.status).toBe(200);
    expect(meContextResponseSchema.parse(replayContext.json)).toMatchObject({
      organizations: [],
      lastActiveTenantId: null,
    });
  });

  it("translates a deterministic membership-conflict accept to the native denial", async () => {
    const owner = await signInOwner();
    const invite = await owner("POST", "/api/auth/organization/invite-member", {
      email: userEmail("preset"),
      role: "viewer",
    });
    expect(invite.status).toBe(200);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("preset"), "คำเชิญ").text,
    );

    const preset = await admitUser("preset", invitationId);
    const userId = await sqlUserId(preset.email);
    // Pre-existing membership (e.g. created by a concurrently committed
    // accept) while the invitation is still pending: the member INSERT must
    // hit member_organization_user_key and surface as the native denial,
    // never as a 5xx.
    await database.sql.query(
      `insert into member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'viewer', now())`,
      [crypto.randomUUID(), ORG_ID, userId],
    );

    const accept = await preset.request(
      "POST",
      "/api/auth/organization/accept-invitation",
      { invitationId },
    );
    expect(accept.status).toBe(400);
    expect(await membershipCount(ORG_ID, userId)).toBe(1);
  });

  it("keeps unrelated database failures visible instead of mislabeling them", async () => {
    const owner = await signInOwner();
    const invite = await owner("POST", "/api/auth/organization/invite-member", {
      email: userEmail("denied"),
      role: "viewer",
    });
    expect(invite.status).toBe(200);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("denied"), "คำเชิญ").text,
    );
    const denied = await admitUser("denied", invitationId);

    // Provoke the unrelated failure on a DEDICATED read-only connection
    // (default_transaction_read_only is a per-session startup option for
    // this pool only) — never by mutating shared role/table grants on the
    // integration database, which would leak into parallel scenarios. The
    // option rides the copied connection string; pg passes it through the
    // startup packet, so no extra pool/drizzle imports are needed.
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
      });
      // The verified session is carried over from the writable app; the
      // read-only connection fails the very first write (the guarded
      // pending -> accepted invitation update, SQLSTATE 25006) — which is
      // not the acceptance race and must stay a visible failure, never the
      // 400 invitation denial.
      const accept = await client(readOnlyApp, denied.request.cookies())(
        "POST",
        "/api/auth/organization/accept-invitation",
        { invitationId },
      );
      expect(accept.status).toBe(500);
      expect(accept.json).toEqual({
        code: "AUTH_INTERNAL_ERROR",
        message: "ไม่สามารถดำเนินการยืนยันตัวตนได้",
      });
      const capturedOutput = JSON.stringify(consoleErrors);
      expect(capturedOutput).not.toContain(invitationId);
      expect(capturedOutput).not.toContain('update "invitation"');
      // The invitation stays pending and no membership was created: the
      // translation boundary only ever re-labels the member uniqueness
      // violation, nothing else.
      expect(await invitationStatus(invitationId)).toBe("pending");
    } finally {
      consoleError.mockRestore();
      await readOnlyDatabase.close();
    }
  });
});

describe("password recovery cycle", () => {
  it("issues a reset token by mail and rotates the password exactly", async () => {
    const owner = await signInOwner();
    const invite = await owner("POST", "/api/auth/organization/invite-member", {
      email: userEmail("recover"),
      role: "viewer",
    });
    expect(invite.status).toBe(200);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("recover"), "คำเชิญ").text,
    );
    const recover = await admitUser("recover", invitationId);
    await recover.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId,
    });

    const request = await recover.request(
      "POST",
      "/api/auth/request-password-reset",
      { email: recover.email, redirectTo: `${APP_URL}/reset-password` },
    );
    expect(request.status).toBe(200);
    const resetMail = findMail(recover.email, "รีเซ็ตรหัสผ่าน");
    const token = linkQuery(resetMail.text, "token");
    const newPassword = "Auth-It-NewPassw0rd!";
    const reset = await recover.request("POST", "/api/auth/reset-password", {
      newPassword,
      token,
    });
    expect(reset.status).toBe(200);

    const oldLogin = await client()("POST", "/api/auth/sign-in/email", {
      email: recover.email,
      password: PASSWORD,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await client()("POST", "/api/auth/sign-in/email", {
      email: recover.email,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);
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
    const reset = await member.request("POST", "/api/auth/reset-password", {
      newPassword: "Auth-It-FirstCredentialPassw0rd!",
      token: linkQuery(findMail(member.email, "รีเซ็ตรหัสผ่าน").text, "token"),
    });
    expect(reset.status).toBe(200);
    expect(await passwordOriginSnapshot(userId)).toMatchObject({
      credentialCount: 1,
      intentCount: 1,
      ledgerCount: 1,
    });
  });
});

describe("TOTP challenge and session boundary", () => {
  it("never yields a session during a pending challenge and accepts a one-time backup code", async () => {
    const owner = await signInOwner();
    const invite = await owner("POST", "/api/auth/organization/invite-member", {
      email: userEmail("totp"),
      role: "viewer",
    });
    expect(invite.status).toBe(200);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("totp"), "คำเชิญ").text,
    );
    const totp = await admitUser("totp", invitationId);
    await totp.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId,
    });

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

    // Enable alone stays pending (SEC-001): enrollment is not active until
    // the first TOTP against the issued secret verifies.
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

    // Complete enrollment with the first real TOTP; only now may sign-in
    // gate behind the two-factor challenge (SEC-C2-TEST-002).
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

    // A backup code is not a TOTP: the authenticator endpoint refuses it.
    const wrongEndpoint = await pending(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: backupCode },
    );
    expect(wrongEndpoint.status).toBe(401);
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

    // The backup code is one-time: a fresh challenge reusing it is denied.
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
    await mfaOwner.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId: ownerInvitationId,
    });
    const active = await mfaOwner.request("PATCH", "/api/me/active-org", {
      organizationId: ORG_ID,
    });
    expect(active.status).toBe(200);
    const owner = mfaOwner.request;
    const invite = await owner("POST", "/api/auth/organization/invite-member", {
      email: userEmail("mfa-intent-failure"),
      role: "viewer",
    });
    expect(invite.status).toBe(200);
    const invitationId = invitationIdFromMail(
      findMail(userEmail("mfa-intent-failure"), "คำเชิญ").text,
    );
    const pending = await admitUser("mfa-intent-failure", invitationId);
    await pending.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId,
    });
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
    await member.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId,
    });
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

    // A missing projection models a verified legacy credential created before
    // its projection migration. The adapter derives the credential state
    // before replacing it, so re-enrollment does not invent MFA_ENABLED.
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
  it("rejects direct native member mutations without touching membership mirrors or notification state, while first-party mutations retain their locked rules", async () => {
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

    const role = await owner.request(
      "PATCH",
      `/api/organizations/${organizationId}/members/${targetMemberId}/role`,
      { role: "admin" },
    );
    expect(role.status).toBe(200);
    const revoke = await owner.request(
      "DELETE",
      `/api/organizations/${organizationId}/members/${targetMemberId}`,
    );
    expect(revoke.status).toBe(200);
    const leave = await leaver.request(
      "DELETE",
      `/api/organizations/${organizationId}/members/me`,
    );
    expect(leave.status).toBe(200);
    const lastOwner = await owner.request(
      "DELETE",
      `/api/organizations/${organizationId}/members/me`,
    );
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.json).toMatchObject({ error: { code: "LAST_OWNER" } });

    const afterFirstParty = await memberMutationSnapshot(
      organizationId,
      ownerId,
      targetMemberId,
      targetId,
      leaverId,
    );
    expect(afterFirstParty).toMatchObject({
      targetRole: null,
      targetMembership: 0,
      leaverMembership: 0,
      targetLastActiveOrganizationId: null,
      leaverLastActiveOrganizationId: null,
      targetActiveOrganizationSessions: 0,
      leaverActiveOrganizationSessions: 0,
      notificationIntentCount: before.notificationIntentCount,
      notificationLedgerCount: before.notificationLedgerCount,
    });
    expect(await membershipCount(organizationId, ownerId)).toBe(1);
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

    // First admission with this mailbox succeeds and creates the account.
    await admitUser("dup", first.id);

    // A second signup for the same mailbox passes the invitation gate but
    // the account exists: with requireEmailVerification the native boundary
    // answers the enumeration-safe generic success (synthetic user echo,
    // token: null). Observable contract: no session, no second user row,
    // existing credentials untouched — and never the member-race denial.
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

    // The original account still authenticates with its original password;
    // the duplicate attempt's password never lands.
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
