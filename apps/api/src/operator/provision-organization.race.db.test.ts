import { createDatabase, runMigrations } from "@nightwatch/db";
import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createApp } from "../app";
import type { Auth, AuthSession } from "../auth";
import type { Mailer, OutboundMail } from "../auth/mailer";
import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  provisionOrganization,
  type ProvisionArgs,
} from "./provision-organization";

// Provisioning of an existing Organization against create, resend, cancel,
// accept and itself. A holder keeps the organization row lock so each pair is
// queued behind it in a known order; the first queued request wins. The link a
// provisioning run mails is its committed id, as in main().

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const runtime = createDatabase(runtimeUrl);
const owner = createDatabase(ownerUrl);
const run = crypto.randomUUID().slice(0, 8);
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: runtimeUrl,
  BETTER_AUTH_SECRET: `provision-race-${run}-0123456789abcdef`,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "Provision <provision@example.test>",
};

const mail: OutboundMail[] = [];
const mailer: Mailer = {
  send: (message) => {
    mail.push(message);
    return Promise.resolve();
  },
  verify: () => Promise.resolve(),
};
const linkIdOf = (message: OutboundMail | undefined) =>
  /accept-invitation\/([0-9a-f-]+)/.exec(message?.text ?? "")?.[1] ?? "";

const users = new Map<string, { id: string; email: string }>();
const orgIds: string[] = [];
async function newUser(label: string) {
  const id = crypto.randomUUID();
  const email = `prov-${label}-${run}@example.test`;
  users.set(label, { id, email });
  await owner.sql.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())`,
    [id, label, email],
  );
  return { id, email };
}
const auth: Auth = {
  handler: () => Promise.resolve(new Response("native auth route not used")),
  getSession: (headers) => {
    const user = users.get(headers.get("x-test-actor") ?? "");
    return Promise.resolve(
      user
        ? ({
            user: {
              id: user.id,
              email: user.email,
              name: user.id,
              emailVerified: true,
            },
            session: {
              id: user.id,
              token: "test-session",
              expiresAt: new Date(Date.now() + 60_000),
            },
          } satisfies AuthSession)
        : null,
    );
  },
};
const app = createApp({
  env,
  authEnv,
  auth,
  database: runtime,
  mailer,
  logger: createLogger(
    { level: "silent", name: "provision-race-db-test" },
    { write: () => {} },
  ),
});

type Result = { status: number; body: Record<string, unknown> };
async function call(
  actor: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result> {
  const response = await app.request(path, {
    method,
    headers: {
      "x-test-actor": actor,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
const createInvitation = (
  org: string,
  address: string,
  role: "owner" | "viewer",
) =>
  call("manager", "POST", `/api/organizations/${org}/invitations`, {
    email: address,
    role,
  });
const resend = (org: string, publicId: string) =>
  call(
    "manager",
    "POST",
    `/api/organizations/${org}/invitations/${publicId}/resend`,
  );
const cancel = (org: string, publicId: string) =>
  call(
    "manager",
    "DELETE",
    `/api/organizations/${org}/invitations/${publicId}`,
  );
const accept = (actor: string, invitationId: string) =>
  call(actor, "POST", `/api/onboarding/invitations/${invitationId}/accept`);
const linkStatus = async (invitationId: string) =>
  (await app.request(`/api/onboarding/invitations/${invitationId}`)).status;
async function listOf(org: string) {
  const result = await call(
    "manager",
    "GET",
    `/api/organizations/${org}/invitations`,
  );
  return result.body as {
    activeCount: number;
    invitations: { publicId: string; email: string; sentAt: string }[];
  };
}

type Outcome = Awaited<ReturnType<typeof provisionOrganization>>;
type Provisioned =
  { ok: true; outcome: Outcome } | { ok: false; message: string };
// Mirrors main(): the core opens the transaction, the caller commits, and a
// thrown refusal rolls back (so main would send nothing and exit 1).
async function provision(args: ProvisionArgs): Promise<Provisioned> {
  const client = await owner.sql.connect();
  try {
    const outcome = await provisionOrganization(client, args);
    await client.query("commit");
    return { ok: true, outcome };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return { ok: false, message: (error as Error).message };
  } finally {
    client.release();
  }
}
function committed(result: Provisioned): Outcome {
  if (!result.ok) throw new Error(`provisioning refused: ${result.message}`);
  return result.outcome;
}

const openHolders: (() => Promise<void>)[] = [];
async function holdOrganizationLock(org: string) {
  const holder = new Client({ connectionString: ownerUrl });
  await holder.connect();
  const pid = (
    await holder.query<{ pid: number }>("select pg_backend_pid() as pid")
  ).rows[0]?.pid;
  if (pid === undefined) throw new Error("no backend pid");
  await holder.query("begin");
  await holder.query("select id from organization where id = $1 for update", [
    org,
  ]);
  let released = false;
  const release = async (action: "commit" | "rollback" = "commit") => {
    if (released) return;
    released = true;
    await holder.query(action);
    await holder.end();
  };
  openHolders.push(() => release("rollback"));
  return { pid, release };
}
// Follows the blocking chain from the holder, so a second waiter queued behind
// the first is counted and other tests' sessions never are.
async function waitUntilQueued(holderPid: number, count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await owner.sql.query<{ waiting: number }>(
      `with recursive chain(pid) as (
         select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))
         union
         select a.pid from pg_stat_activity a
         join chain c on c.pid = any(pg_blocking_pids(a.pid))
       ) select count(*)::int as waiting from chain`,
      [holderPid],
    );
    if ((waiting.rows[0]?.waiting ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("requests never queued behind the holder's lock");
}
async function raceInOrder<First, Second>(
  org: string,
  startFirst: () => Promise<First>,
  startSecond: () => Promise<Second>,
) {
  const lock = await holdOrganizationLock(org);
  const first = startFirst();
  await waitUntilQueued(lock.pid, 1);
  const second = startSecond();
  await waitUntilQueued(lock.pid, 2);
  await lock.release();
  return { first: await first, second: await second };
}

type Fixture = { org: string; slug: string; name: string };
async function newOrg(label: string): Promise<Fixture> {
  const org = crypto.randomUUID();
  const slug = `nw-provrace-${run}-${label}`;
  orgIds.push(org);
  await owner.sql.query(
    "insert into organization (id, name, slug) values ($1, $2, $3)",
    [org, `Provision ${label}`, slug],
  );
  await owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
    [crypto.randomUUID(), org, users.get("manager")?.id],
  );
  return { org, slug, name: `Provision ${label}` };
}
const argsFor = (fixture: Fixture, ownerEmail: string): ProvisionArgs => ({
  name: fixture.name,
  slug: fixture.slug,
  ownerEmail,
});
async function seed(
  org: string,
  address: string,
  options: { role?: string; expiresIn?: string; sentAgo?: string } = {},
) {
  const id = crypto.randomUUID();
  const result = await owner.sql.query<{ publicId: string }>(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     values ($1, $2, $3, $4, 'pending', $5, clock_timestamp() + $6::interval,
       clock_timestamp(), clock_timestamp() - $7::interval)
     returning public_id as "publicId"`,
    [
      id,
      org,
      address,
      options.role ?? "owner",
      users.get("manager")?.id,
      options.expiresIn ?? "1 day",
      options.sentAgo ?? "301 seconds",
    ],
  );
  return { id, publicId: result.rows[0]?.publicId ?? "" };
}
async function seedLive(org: string, count: number) {
  await owner.sql.query(
    `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     select gen_random_uuid()::text, $1, 'live-' || n || $2, 'viewer', 'pending', $3,
            now() + interval '1 day', now(), now()
     from generate_series(1, $4::int) n`,
    [org, `-${run}@example.test`, users.get("manager")?.id, count],
  );
}
async function liveRows(org: string, address: string) {
  return (
    await owner.sql.query<{ id: string; role: string }>(
      `select id, role from invitation
       where organization_id = $1 and lower(email) = lower($2)
         and status = 'pending' and expires_at > clock_timestamp()`,
      [org, address],
    )
  ).rows;
}
async function statusOf(publicId: string) {
  return (
    await owner.sql.query<{ id: string; status: string }>(
      "select id, status from invitation where public_id = $1",
      [publicId],
    )
  ).rows[0];
}
async function isMember(org: string, userId: string) {
  return (
    (
      await owner.sql.query(
        "select 1 from member where organization_id = $1 and user_id = $2",
        [org, userId],
      )
    ).rows.length > 0
  );
}
const QUOTA_MESSAGE = (slug: string) =>
  `Organization "${slug}" already has 100 pending invitations; no invitation was created.`;

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await newUser("manager");
}, 120_000);

beforeEach(() => {
  mail.length = 0;
});
afterEach(async () => {
  await Promise.all(openHolders.splice(0).map((release) => release()));
});
afterAll(async () => {
  try {
    await owner.sql.query(
      "delete from organization where id = any($1::uuid[])",
      [orgIds],
    );
    await owner.sql.query('delete from "user" where id = any($1::text[])', [
      [...users.values()].map((user) => user.id),
    ]);
  } finally {
    await owner.close();
    await runtime.close();
  }
});

describe("provisioning an existing organization", () => {
  it("at 99 live rows creates one owner row with sent_at = created_at and a 48 hour link, first on the list, activeCount 100", async () => {
    const fixture = await newOrg("c99");
    await seedLive(fixture.org, 99);
    const address = `new-${run}-c99@Example.test`;

    const created = committed(await provision(argsFor(fixture, address)));

    expect(created.resent).toBe(false);
    const row = await owner.sql.query<{
      role: string;
      sameInstant: boolean;
      lifetime: number;
    }>(
      `select role, sent_at = created_at as "sameInstant",
              extract(epoch from expires_at - sent_at)::int as lifetime
       from invitation where id = $1`,
      [created.invitationId],
    );
    expect(row.rows[0]).toEqual({
      role: "owner",
      sameInstant: true,
      lifetime: 48 * 3600,
    });
    const list = await listOf(fixture.org);
    expect(list.activeCount).toBe(100);
    expect(list.invitations[0]?.email.toLowerCase()).toBe(
      address.toLowerCase(),
    );
  });

  it.each([
    ["100 live rows", 100, false],
    ["100 live rows plus an expired row", 100, true],
  ])("refuses at %s and changes nothing", async (_label, live, withExpired) => {
    const fixture = await newOrg(`c100-${String(withExpired)}`);
    await seedLive(fixture.org, live);
    const address = `new-${run}-c100-${String(withExpired)}@example.test`;
    if (withExpired) await seed(fixture.org, address, { expiresIn: "-1 hour" });
    const before = await owner.sql.query(
      "select id, status, updated_at from invitation where organization_id = $1 order by id",
      [fixture.org],
    );

    const refused = await provision(argsFor(fixture, address));

    expect(refused).toEqual({
      ok: false,
      message: QUOTA_MESSAGE(fixture.slug),
    });
    const after = await owner.sql.query(
      "select id, status, updated_at from invitation where organization_id = $1 order by id",
      [fixture.org],
    );
    expect(after.rows).toEqual(before.rows);
    expect((await listOf(fixture.org)).activeCount).toBe(100);
  });

  it("cancels the expired row of the same email when it creates, and that link gets 404", async () => {
    const fixture = await newOrg("expired");
    const address = `Expired-${run}@example.test`;
    const expired = await seed(fixture.org, address, { expiresIn: "-1 hour" });

    const created = committed(await provision(argsFor(fixture, address)));

    expect((await statusOf(expired.publicId))?.status).toBe("canceled");
    expect(await linkStatus(expired.id)).toBe(404);
    expect(await linkStatus(created.invitationId)).toBe(200);
    expect(await liveRows(fixture.org, address)).toHaveLength(1);
  });

  it("re-send rotates the id in place: same public_id, no new row, old link 404, new link 200, first on the list, activeCount unchanged, then F-006 resend is on cooldown until sent_at + 300 s", async () => {
    const fixture = await newOrg("resend");
    const address = `resend-${run}@example.test`;
    await seedLive(fixture.org, 5);
    const row = await seed(fixture.org, address, { sentAgo: "2 hours" });
    const countBefore = (await listOf(fixture.org)).activeCount;

    const outcome = committed(await provision(argsFor(fixture, address)));

    expect(outcome.resent).toBe(true);
    expect(outcome.invitationId).not.toBe(row.id);
    const after = await owner.sql.query<{
      id: string;
      rows: number;
      lifetime: number;
      sentFresh: boolean;
    }>(
      `select id, (select count(*)::int from invitation where organization_id = $1) as rows,
              extract(epoch from expires_at - sent_at)::int as lifetime,
              sent_at > clock_timestamp() - interval '1 minute' as "sentFresh"
       from invitation where public_id = $2`,
      [fixture.org, row.publicId],
    );
    expect(after.rows[0]).toEqual({
      id: outcome.invitationId,
      rows: 6,
      lifetime: 48 * 3600,
      sentFresh: true,
    });
    expect(await linkStatus(row.id)).toBe(404);
    expect(await linkStatus(outcome.invitationId)).toBe(200);
    const list = await listOf(fixture.org);
    expect(list.activeCount).toBe(countBefore);
    expect(list.invitations[0]?.publicId).toBe(row.publicId);

    // A second operator re-send inside 300 s still succeeds (no cooldown).
    const again = committed(await provision(argsFor(fixture, address)));
    expect(again.resent).toBe(true);
    expect(again.invitationId).not.toBe(outcome.invitationId);

    const cooling = await resend(fixture.org, row.publicId);
    expect(cooling).toMatchObject({
      status: 429,
      body: { error: { code: "INVITATION_RESEND_COOLDOWN" } },
    });
    expect(mail).toHaveLength(0);
  });

  it("leaves a live admin invitation unchanged and refuses", async () => {
    const fixture = await newOrg("admin");
    const address = `admin-${run}@example.test`;
    const row = await seed(fixture.org, address, { role: "admin" });
    const before = await owner.sql.query(
      "select * from invitation where organization_id = $1",
      [fixture.org],
    );

    const refused = await provision(argsFor(fixture, address));

    expect(refused.ok).toBe(false);
    expect(
      await owner.sql.query(
        "select * from invitation where organization_id = $1",
        [fixture.org],
      ),
    ).toMatchObject({ rows: before.rows });
    expect((await statusOf(row.publicId))?.id).toBe(row.id);
  });
});

describe("provisioning races (the first request to take the organization lock wins)", () => {
  describe("x create, same email", () => {
    it("provisioning first: create gets INVITATION_ALREADY_PENDING, no create mail, provisioned link works", async () => {
      const fixture = await newOrg("cs-pf");
      const address = `cs-pf-${run}@example.test`;
      const row = await seed(fixture.org, address, { sentAgo: "1 hour" });
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, address)),
        () => createInvitation(fixture.org, address.toLowerCase(), "owner"),
      );
      const outcome = committed(first);
      expect(second).toMatchObject({
        status: 409,
        body: { error: { code: "INVITATION_ALREADY_PENDING" } },
      });
      expect(mail).toHaveLength(0);
      expect(await liveRows(fixture.org, address)).toEqual([
        { id: outcome.invitationId, role: "owner" },
      ]);
      expect(await linkStatus(row.id)).toBe(404);
      expect(await linkStatus(outcome.invitationId)).toBe(200);
    });

    it("create (role owner) first: provisioning rotates the row, the create link gets 404, the provisioned link works", async () => {
      const fixture = await newOrg("cs-cf");
      const address = `cs-cf-${run}@example.test`;
      const { first, second } = await raceInOrder(
        fixture.org,
        () => createInvitation(fixture.org, address.toLowerCase(), "owner"),
        () => provision(argsFor(fixture, address)),
      );
      expect(first.status).toBe(201);
      const outcome = committed(second);
      expect(outcome.resent).toBe(true);
      expect(mail).toHaveLength(1);
      expect(await linkStatus(linkIdOf(mail[0]))).toBe(404);
      expect(await linkStatus(outcome.invitationId)).toBe(200);
      expect(await liveRows(fixture.org, address)).toHaveLength(1);
    });

    it("create (role viewer) first: provisioning refuses and leaves the row, create link still works", async () => {
      const fixture = await newOrg("cs-cv");
      const address = `cs-cv-${run}@example.test`;
      const { first, second } = await raceInOrder(
        fixture.org,
        () => createInvitation(fixture.org, address.toLowerCase(), "viewer"),
        () => provision(argsFor(fixture, address)),
      );
      expect(first.status).toBe(201);
      expect(second.ok).toBe(false);
      const live = await liveRows(fixture.org, address);
      expect(live).toHaveLength(1);
      expect(live[0]?.role).toBe("viewer");
      expect(live[0]?.id).toBe(linkIdOf(mail[0]));
      expect(await linkStatus(linkIdOf(mail[0]))).toBe(200);
    });
  });

  describe("x create, other email at 99 live rows", () => {
    async function setup(label: string) {
      const fixture = await newOrg(label);
      await seedLive(fixture.org, 99);
      return {
        fixture,
        provisionEmail: `p-${run}-${label}@example.test`,
        otherEmail: `o-${run}-${label}@example.test`,
      };
    }
    it("provisioning first: create gets INVITATION_LIMIT_REACHED and activeCount is 100", async () => {
      const { fixture, provisionEmail, otherEmail } = await setup("c99-pf");
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, provisionEmail)),
        () => createInvitation(fixture.org, otherEmail, "viewer"),
      );
      expect(first.ok).toBe(true);
      expect(second).toMatchObject({
        status: 409,
        body: { error: { code: "INVITATION_LIMIT_REACHED" } },
      });
      expect(mail).toHaveLength(0);
      expect((await listOf(fixture.org)).activeCount).toBe(100);
    });
    it("create first: provisioning refuses with the quota message and activeCount is 100", async () => {
      const { fixture, provisionEmail, otherEmail } = await setup("c99-cf");
      const { first, second } = await raceInOrder(
        fixture.org,
        () => createInvitation(fixture.org, otherEmail, "viewer"),
        () => provision(argsFor(fixture, provisionEmail)),
      );
      expect(first.status).toBe(201);
      expect(second).toEqual({
        ok: false,
        message: QUOTA_MESSAGE(fixture.slug),
      });
      expect(mail).toHaveLength(1);
      expect(await liveRows(fixture.org, provisionEmail)).toHaveLength(0);
      expect((await listOf(fixture.org)).activeCount).toBe(100);
    });
  });

  describe("x resend of an expired invitation of another email at 99 live rows", () => {
    async function setup(label: string) {
      const fixture = await newOrg(label);
      await seedLive(fixture.org, 99);
      const expired = await seed(
        fixture.org,
        `x-${run}-${label}@example.test`,
        {
          role: "viewer",
          expiresIn: "-1 hour",
        },
      );
      return {
        fixture,
        expired,
        provisionEmail: `p-${run}-${label}@example.test`,
      };
    }
    it("provisioning first: resend gets INVITATION_LIMIT_REACHED, nothing is sent, activeCount is 100", async () => {
      const { fixture, expired, provisionEmail } = await setup("r99-pf");
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, provisionEmail)),
        () => resend(fixture.org, expired.publicId),
      );
      expect(first.ok).toBe(true);
      expect(second).toMatchObject({
        status: 409,
        body: { error: { code: "INVITATION_LIMIT_REACHED" } },
      });
      expect(mail).toHaveLength(0);
      expect((await listOf(fixture.org)).activeCount).toBe(100);
    });
    it("resend first: provisioning refuses with the quota message and activeCount is 100", async () => {
      const { fixture, expired, provisionEmail } = await setup("r99-rf");
      const { first, second } = await raceInOrder(
        fixture.org,
        () => resend(fixture.org, expired.publicId),
        () => provision(argsFor(fixture, provisionEmail)),
      );
      expect(first.status).toBe(200);
      expect(second).toEqual({
        ok: false,
        message: QUOTA_MESSAGE(fixture.slug),
      });
      expect(mail).toHaveLength(1);
      expect((await listOf(fixture.org)).activeCount).toBe(100);
    });
  });

  describe("x resend of a live owner invitation, same email", () => {
    it("provisioning first: resend reads the new sent_at and gets 429, nothing is sent, provisioned link works", async () => {
      const fixture = await newOrg("ro-pf");
      const address = `ro-pf-${run}@example.test`;
      const row = await seed(fixture.org, address);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, address)),
        () => resend(fixture.org, row.publicId),
      );
      const outcome = committed(first);
      expect(second).toMatchObject({
        status: 429,
        body: { error: { code: "INVITATION_RESEND_COOLDOWN" } },
      });
      expect(mail).toHaveLength(0);
      expect(await linkStatus(outcome.invitationId)).toBe(200);
      expect(await liveRows(fixture.org, address)).toHaveLength(1);
    });
    it("resend first: provisioning rotates again without a cooldown, the resend link gets 404, the provisioned link works", async () => {
      const fixture = await newOrg("ro-rf");
      const address = `ro-rf-${run}@example.test`;
      const row = await seed(fixture.org, address);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => resend(fixture.org, row.publicId),
        () => provision(argsFor(fixture, address)),
      );
      expect(first.status).toBe(200);
      const outcome = committed(second);
      expect(mail).toHaveLength(1);
      expect(await linkStatus(linkIdOf(mail[0]))).toBe(404);
      expect(await linkStatus(outcome.invitationId)).toBe(200);
      expect(await liveRows(fixture.org, address)).toHaveLength(1);
    });
  });

  describe("x resend of an expired invitation, same email", () => {
    it("provisioning first: expired row canceled and replaced, resend gets 404, nothing is sent", async () => {
      const fixture = await newOrg("re-pf");
      const address = `re-pf-${run}@example.test`;
      const row = await seed(fixture.org, address, { expiresIn: "-1 hour" });
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, address)),
        () => resend(fixture.org, row.publicId),
      );
      const outcome = committed(first);
      expect(outcome.resent).toBe(false);
      expect(second).toMatchObject({
        status: 404,
        body: { error: { code: "INVITATION_NOT_FOUND" } },
      });
      expect(mail).toHaveLength(0);
      expect((await statusOf(row.publicId))?.status).toBe("canceled");
      expect(await liveRows(fixture.org, address)).toEqual([
        { id: outcome.invitationId, role: "owner" },
      ]);
    });
    it("resend first: the row is live, provisioning rotates it and the resend link gets 404", async () => {
      const fixture = await newOrg("re-rf");
      const address = `re-rf-${run}@example.test`;
      const row = await seed(fixture.org, address, { expiresIn: "-1 hour" });
      const { first, second } = await raceInOrder(
        fixture.org,
        () => resend(fixture.org, row.publicId),
        () => provision(argsFor(fixture, address)),
      );
      expect(first.status).toBe(200);
      const outcome = committed(second);
      expect(outcome.resent).toBe(true);
      expect(await linkStatus(linkIdOf(mail[0]))).toBe(404);
      expect(await linkStatus(outcome.invitationId)).toBe(200);
      expect(await liveRows(fixture.org, address)).toHaveLength(1);
    });
    it("resend first with a non-owner role: provisioning refuses and the row stays", async () => {
      const fixture = await newOrg("re-rv");
      const address = `re-rv-${run}@example.test`;
      const row = await seed(fixture.org, address, {
        role: "viewer",
        expiresIn: "-1 hour",
      });
      const { first, second } = await raceInOrder(
        fixture.org,
        () => resend(fixture.org, row.publicId),
        () => provision(argsFor(fixture, address)),
      );
      expect(first.status).toBe(200);
      expect(second.ok).toBe(false);
      expect(await linkStatus(linkIdOf(mail[0]))).toBe(200);
      expect(await liveRows(fixture.org, address)).toHaveLength(1);
    });
  });

  describe("x cancel", () => {
    it("provisioning first: cancel cancels the rotated row and the provisioned link gets 404", async () => {
      const fixture = await newOrg("ca-pf");
      const address = `ca-pf-${run}@example.test`;
      const row = await seed(fixture.org, address);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, address)),
        () => cancel(fixture.org, row.publicId),
      );
      const outcome = committed(first);
      expect(second.status).toBe(200);
      expect((await statusOf(row.publicId))?.status).toBe("canceled");
      expect(await linkStatus(outcome.invitationId)).toBe(404);
      expect(await liveRows(fixture.org, address)).toHaveLength(0);
    });
    it("cancel first: provisioning finds no live row and creates a new one that works", async () => {
      const fixture = await newOrg("ca-cf");
      const address = `ca-cf-${run}@example.test`;
      const row = await seed(fixture.org, address);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => cancel(fixture.org, row.publicId),
        () => provision(argsFor(fixture, address)),
      );
      expect(first.status).toBe(200);
      const outcome = committed(second);
      expect(outcome.resent).toBe(false);
      expect(await linkStatus(outcome.invitationId)).toBe(200);
      expect(await liveRows(fixture.org, address)).toHaveLength(1);
    });
  });

  describe("x accept", () => {
    it("provisioning first: the old id gets 404 on accept, the new link accepts", async () => {
      const fixture = await newOrg("ac-pf");
      const invitee = await newUser("ac-pf");
      const row = await seed(fixture.org, invitee.email);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, invitee.email)),
        () => accept("ac-pf", row.id),
      );
      const outcome = committed(first);
      expect(second).toMatchObject({
        status: 404,
        body: { error: { code: "INVITATION_NOT_FOUND" } },
      });
      expect(await isMember(fixture.org, invitee.id)).toBe(false);
      expect((await accept("ac-pf", outcome.invitationId)).status).toBe(200);
      expect(await isMember(fixture.org, invitee.id)).toBe(true);
    });
    it("accept first: provisioning reports already a member and sends nothing", async () => {
      const fixture = await newOrg("ac-af");
      const invitee = await newUser("ac-af");
      const row = await seed(fixture.org, invitee.email);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => accept("ac-af", row.id),
        () => provision(argsFor(fixture, invitee.email)),
      );
      expect(first.status).toBe(200);
      const outcome = committed(second);
      expect(outcome.alreadyMember).toBe(true);
      expect(outcome.invitationId).toBe("");
      expect(await isMember(fixture.org, invitee.id)).toBe(true);
      expect(await liveRows(fixture.org, invitee.email)).toHaveLength(0);
    });
  });

  describe("x provisioning, same slug", () => {
    // The runs are interchangeable, so one queue order covers both.
    it("both re-send, one live row, only the later commit's link works", async () => {
      const fixture = await newOrg("pp");
      const address = `pp-${run}@example.test`;
      const row = await seed(fixture.org, address);
      const { first, second } = await raceInOrder(
        fixture.org,
        () => provision(argsFor(fixture, address)),
        () => provision(argsFor(fixture, address)),
      );
      const earlier = committed(first);
      const later = committed(second);
      expect(earlier.resent && later.resent).toBe(true);
      expect(earlier.invitationId).not.toBe(later.invitationId);
      expect(await linkStatus(row.id)).toBe(404);
      expect(await linkStatus(earlier.invitationId)).toBe(404);
      expect(await linkStatus(later.invitationId)).toBe(200);
      expect(await liveRows(fixture.org, address)).toEqual([
        { id: later.invitationId, role: "owner" },
      ]);
    });
  });
});
