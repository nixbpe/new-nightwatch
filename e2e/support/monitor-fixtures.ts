import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Pool } from "pg";

import { resolveDevEnv } from "../../scripts/dev-env.mjs";

const { env, ports } = resolveDevEnv();

export type Role = "owner" | "admin" | "viewer" | "auditor";

export type Person = {
  userId: string;
  email: string;
  password: string;
};

/**
 * Hostname the app may reach on loopback. Comes from the same variable the API
 * and Worker read, so the config and the tests cannot disagree. CI maps
 * target.nw-test.internal to 127.0.0.1 in /etc/hosts; locally use a name that
 * resolves to 127.0.0.1 (see scripts/quality/README.md).
 */
export function targetHostname(): string {
  const host = (process.env.OUTBOUND_TEST_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .find((value) => value !== "");
  if (host === undefined) {
    throw new Error(
      "OUTBOUND_TEST_ALLOWED_HOSTS must name a hostname that resolves to 127.0.0.1",
    );
  }
  return host;
}

export const apiOrigin = `http://localhost:${ports.apiPort}`;
export const webOrigin = `http://localhost:${ports.webPort}`;
export const databaseOwnerUrl = env.DATABASE_OWNER_URL!;

export async function createOrganization(
  pool: Pool,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into organization (id, name, slug, created_at, updated_at)
     values ($1, $2, $3, now(), now())`,
    [id, name, `monitor-e2e-${id}`],
  );
  return id;
}

export async function createPerson(
  pool: Pool,
  label: string,
  activeOrganizationId: string | null,
): Promise<Person> {
  const userId = randomUUID();
  const password = `monitor-e2e-${randomUUID()}`;
  const email = `monitor-${label}-${randomUUID()}@nightwatch.invalid`;
  await pool.query(
    `insert into "user"
       (id, name, email, email_verified, last_active_tenant_id, created_at, updated_at)
     values ($1, $2, $3, true, $4, now(), now())`,
    [userId, `Monitor E2E ${label}`, email, activeOrganizationId],
  );
  await pool.query(
    `insert into account
       (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [randomUUID(), userId, await hashPassword(password)],
  );
  return { userId, email, password };
}

export async function addMember(
  pool: Pool,
  organizationId: string,
  userId: string,
  role: Role,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into member (id, organization_id, user_id, role, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, organizationId, userId, role],
  );
  return id;
}

/** Removes everything a run created; users first so sessions and members go with them. */
export async function cleanUp(
  pool: Pool,
  userIds: string[],
  organizationIds: string[],
): Promise<void> {
  await pool.query('delete from "user" where id = any($1::text[])', [userIds]);
  await pool.query("delete from organization where id = any($1::uuid[])", [
    organizationIds,
  ]);
}

/** A signed-in API session for direct requests (same origin rules as the browser). */
export type ApiSession = {
  request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;
};

export async function signInApi(person: Person): Promise<ApiSession> {
  const response = await fetch(`${apiOrigin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: webOrigin },
    body: JSON.stringify({ email: person.email, password: person.password }),
  });
  if (response.status !== 200) {
    throw new Error(`sign-in failed with ${String(response.status)}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return {
    async request(method, path, body) {
      const reply = await fetch(`${apiOrigin}${path}`, {
        method,
        headers: {
          cookie,
          origin: webOrigin,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await reply.text();
      let parsed: unknown = text;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        // Keep the raw text for a non-JSON reply.
      }
      return { status: reply.status, body: parsed };
    },
  };
}

export function monitorPath(organizationId: string, suffix = ""): string {
  return `/api/organizations/${organizationId}/monitors${suffix}`;
}

export function basicConfig(name: string, url: string) {
  return {
    name,
    url,
    intervalSeconds: 60,
    timeoutSeconds: 10,
    method: "GET",
    headers: [],
    queryParams: [],
    body: null,
    expectedStatus: "200-299",
    assertions: [],
    auth: { type: "none" },
    secrets: [],
  };
}

/**
 * Screenshot into VERIFY_SHOTS_DIR when set (docs/features/F-005-uptime-monitor/verification/).
 * Desktop shots use a 1440 x 900 viewport and restore the page size afterwards;
 * `keepViewport` keeps the current size (the 640 px reflow shots).
 */
export async function shot(
  page: Page,
  name: string,
  keepViewport = false,
): Promise<void> {
  const dir = process.env.VERIFY_SHOTS_DIR;
  if (!dir) return;
  const original = page.viewportSize();
  if (!keepViewport) await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${dir}/${name}.png` });
  if (!keepViewport && original) await page.setViewportSize(original);
}
