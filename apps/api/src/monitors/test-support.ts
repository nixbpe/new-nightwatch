import type { MonitorConfigInput } from "@nightwatch/api-contract";
import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import {
  createLogger,
  type AuthEnv,
  type Env,
  type Logger,
} from "@nightwatch/shared";
import { fileURLToPath } from "node:url";

import { createApp } from "../app";
import type { Auth, AuthSession } from "../auth";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

export type TestRole = "owner" | "admin" | "viewer" | "auditor";
export const TEST_ROLES: readonly TestRole[] = [
  "owner",
  "admin",
  "viewer",
  "auditor",
];

export type TestOrganization = {
  id: string;
  users: Record<TestRole, string>;
};

export type ApiResponse = {
  status: number;
  json: unknown;
  headers: Headers;
};

/** Hostnames of the DNS stub; anything else does not resolve. */
export const STUB_HOSTS = {
  public: "public.monitor-test.example",
  internal: "internal.monitor-test.example",
  mixed: "mixed.monitor-test.example",
  loopback: "loopback.monitor-test.example",
  allowed: "allowed.monitor-test.example",
  missing: "missing.monitor-test.example",
} as const;

const STUB_ADDRESSES: Record<string, string[]> = {
  [STUB_HOSTS.public]: ["93.184.216.34"],
  [STUB_HOSTS.internal]: ["10.0.0.5"],
  [STUB_HOSTS.mixed]: ["93.184.216.34", "10.0.0.5"],
  [STUB_HOSTS.loopback]: ["127.0.0.1"],
  [STUB_HOSTS.allowed]: ["127.0.0.1"],
};

export function validConfig(
  overrides: Partial<MonitorConfigInput> = {},
): MonitorConfigInput {
  return {
    name: "Monitor",
    url: `https://${STUB_HOSTS.public}/health`,
    ...overrides,
  };
}

/**
 * Real app and database, stub auth: a request names its user in `x-test-user`.
 * Every fixture id is run-unique and removed in `close`.
 */
export async function openMonitorTestContext(options?: {
  auditFailure?: boolean;
}) {
  const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
  const migrationsDir =
    process.env.MIGRATIONS_DIR ??
    fileURLToPath(
      new URL("../../../../packages/db/migrations", import.meta.url),
    );
  const runtime: Database = createDatabase(runtimeUrl);
  const owner: Database = createDatabase(ownerUrl);
  await runMigrations({ url: ownerUrl, migrationsDir });

  const run = crypto.randomUUID().slice(0, 8);
  const lines: string[] = [];
  const base = createLogger(
    { level: "info", name: "monitor-write-db-test" },
    { write: (line: string) => void lines.push(line) },
  );
  // `auditFailure` makes only the audit line throw, to prove a logger failure
  // cannot fail a committed mutation (the request log line must still work).
  const logger: Logger = options?.auditFailure
    ? Object.assign(Object.create(base) as Logger, {
        info: (fields: object, message?: string) => {
          if (message === "monitor mutation") throw new Error("log down");
          base.info(fields, message);
        },
      })
    : base;

  const appUrl = "http://localhost:5173";
  const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
  const authEnv: AuthEnv = {
    DATABASE_URL: runtimeUrl,
    BETTER_AUTH_SECRET: `monitor-write-${run}-0123456789abcdef`,
    APP_URL: appUrl,
    BETTER_AUTH_URL: "http://localhost:4000",
    CORS_ORIGIN: appUrl,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_FROM: "Monitor tests <monitor@example.test>",
  };
  const users = new Map<string, AuthSession>();
  const auth: Auth = {
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    getSession: (headers) =>
      Promise.resolve(users.get(headers.get("x-test-user") ?? "") ?? null),
  };
  const app = createApp({
    env,
    authEnv,
    auth,
    database: runtime,
    mailer: {
      send: () => Promise.resolve(),
      verify: () => Promise.resolve(),
    },
    logger,
    outbound: {
      resolver: (hostname) => {
        const addresses = STUB_ADDRESSES[hostname];
        if (!addresses) {
          return Promise.reject(
            Object.assign(new Error("not found"), { code: "ENOTFOUND" }),
          );
        }
        return Promise.resolve(addresses);
      },
      testAllowedHosts: [STUB_HOSTS.allowed],
    },
  });

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  async function createUser(label: string): Promise<string> {
    const id = crypto.randomUUID();
    const email = `${label}-${run}-${id.slice(0, 4)}@example.test`;
    await owner.sql.query(
      'insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
      [id, label, email],
    );
    users.set(id, {
      user: { id, email, name: label, emailVerified: true },
      session: {
        id: `session-${id}`,
        token: `token-${id}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    userIds.push(id);
    return id;
  }

  async function createOrganization(label: string): Promise<TestOrganization> {
    const id = crypto.randomUUID();
    await owner.sql.query(
      "insert into organization (id, name, slug, created_at) values ($1, $2, $3, now())",
      [id, `${label} ${run}`, `${label}-${run}-${id.slice(0, 4)}`],
    );
    organizationIds.push(id);
    const members = {} as Record<TestRole, string>;
    for (const role of TEST_ROLES) {
      const userId = await createUser(`${label}-${role}`);
      members[role] = userId;
      await owner.sql.query(
        `insert into member (id, organization_id, user_id, role, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [crypto.randomUUID(), id, userId, role],
      );
    }
    return { id, users: members };
  }

  async function call(
    userId: string | null,
    method: "DELETE" | "GET" | "PATCH" | "POST",
    path: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const headers = new Headers();
    if (userId) headers.set("x-test-user", userId);
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      headers.set("origin", appUrl);
    }
    const response = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      json: text ? (JSON.parse(text) as unknown) : null,
      headers: response.headers,
    };
  }

  async function close(): Promise<void> {
    await owner.sql.query(
      "delete from organization where id = any($1::uuid[])",
      [organizationIds],
    );
    await owner.sql.query('delete from "user" where id = any($1::text[])', [
      userIds,
    ]);
    await owner.close();
    await runtime.close();
  }

  return {
    run,
    runtime,
    owner,
    lines,
    createUser,
    createOrganization,
    call,
    close,
    logRecords: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export type MonitorTestContext = Awaited<
  ReturnType<typeof openMonitorTestContext>
>;

export const monitorsPath = (organizationId: string, suffix = ""): string =>
  `/api/organizations/${organizationId}/monitors${suffix}`;
