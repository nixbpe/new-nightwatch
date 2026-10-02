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

const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const runtime = createDatabase(runtimeUrl);
const owner = createDatabase(ownerUrl);
const run = crypto.randomUUID();
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const orgFull = crypto.randomUUID();
const absentOrg = crypto.randomUUID();
const roles = ["owner", "admin", "viewer", "auditor"] as const;
const actorNames = [
  ...roles.map((role) => `${role}A`),
  ...roles.map((role) => `${role}B`),
  "outsider",
  "invitee1",
  "invitee2",
  "invitee3",
  "invitee4",
  "joined",
  "fullOwner",
];
const actorIds = Object.fromEntries(
  actorNames.map((name) => [name, crypto.randomUUID()]),
) as Record<string, string>;
const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: runtimeUrl,
  BETTER_AUTH_SECRET: `resend-${run}`,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "Invitation <invite@example.test>",
};
const mail: OutboundMail[] = [];
let attempts = 0;
let smtpFails = false;
// Whether the id in each sent link was already visible to another session, so
// a mail sent inside the transaction would show up as false.
const linkCommittedAtSend: boolean[] = [];
const mailer: Mailer = {
  send: async (message) => {
    attempts += 1;
    const linkId = /accept-invitation\/([0-9a-f-]+)/.exec(message.text)?.[1];
    if (linkId !== undefined) {
      const visible = await owner.sql.query(
        "select 1 from invitation where id = $1",
        [linkId],
      );
      linkCommittedAtSend.push(visible.rows.length === 1);
    }
    if (smtpFails) throw new Error("smtp down");
    mail.push(message);
  },
  verify: () => Promise.resolve(),
};
const email = (label: string) => `${label}-${run}@example.test`;
const auth: Auth = {
  handler: () => Promise.resolve(new Response("native auth route not used")),
  getSession: (headers) => {
    const actor = headers.get("x-test-actor");
    const id = actor ? actorIds[actor] : undefined;
    return Promise.resolve(
      actor && id
        ? ({
            user: {
              id,
              email: email(actor.toLowerCase()),
              name: id,
              emailVerified: true,
            },
            session: {
              id,
              token: "test-session",
              expiresAt: new Date(Date.now() + 60_000),
            },
          } satisfies AuthSession)
        : null,
    );
  },
};
const logs: string[] = [];
const app = createApp({
  env,
  authEnv,
  auth,
  database: runtime,
  mailer,
  logger: createLogger(
    { level: "info", name: "invitation-resend-db-test" },
    {
      write: (line: string) => {
        logs.push(line);
      },
    },
  ),
});
const migrationsDir = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

type Result = { status: number; body: Record<string, unknown> };

async function resend(
  actor: string,
  org: string,
  publicId: string,
): Promise<Result> {
  const response = await app.request(
    `/api/organizations/${org}/invitations/${publicId}/resend`,
    { method: "POST", headers: { "x-test-actor": actor } },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
async function cancel(
  actor: string,
  org: string,
  publicId: string,
): Promise<Result> {
  const response = await app.request(
    `/api/organizations/${org}/invitations/${publicId}`,
    { method: "DELETE", headers: { "x-test-actor": actor } },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
async function createWith(
  actor: string,
  org: string,
  address: string,
): Promise<Result> {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-actor": actor },
    body: JSON.stringify({ email: address, role: "viewer" }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
async function accept(actor: string, invitationId: string): Promise<Result> {
  const response = await app.request(
    `/api/onboarding/invitations/${invitationId}/accept`,
    { method: "POST", headers: { "x-test-actor": actor } },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
async function previewStatus(invitationId: string) {
  return (await app.request(`/api/onboarding/invitations/${invitationId}`))
    .status;
}
async function seed(
  org: string,
  address: string,
  options: {
    role?: string;
    status?: string;
    expiresIn?: string | null;
    sentAgo?: string;
  } = {},
) {
  const id = crypto.randomUUID();
  const expiresIn =
    options.expiresIn === undefined ? "1 day" : options.expiresIn;
  const result = await owner.sql.query<{ publicId: string }>(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     values ($1, $2, $3, $4, $5, $6,
       case when $7::text is null then null else clock_timestamp() + $7::interval end,
       clock_timestamp(), clock_timestamp() - $8::interval)
     returning public_id as "publicId"`,
    [
      id,
      org,
      address,
      options.role ?? "viewer",
      options.status ?? "pending",
      actorIds.ownerA,
      expiresIn,
      options.sentAgo ?? "301 seconds",
    ],
  );
  return { id, publicId: result.rows[0]?.publicId ?? "" };
}
type RowState = {
  id: string;
  status: string;
  lifetimeSeconds: number | null;
};
async function rowOf(publicId: string): Promise<RowState> {
  const result = await owner.sql.query<RowState>(
    `select id, status,
       extract(epoch from expires_at - sent_at)::float as "lifetimeSeconds"
     from invitation where public_id = $1`,
    [publicId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("invitation row missing");
  return row;
}
async function rowCount(org: string, address: string) {
  return (
    await owner.sql.query<{ n: number }>(
      "select count(*)::int as n from invitation where organization_id = $1 and lower(email) = lower($2)",
      [org, address],
    )
  ).rows[0]?.n;
}
async function setSentAgo(publicId: string, interval: string) {
  await owner.sql.query(
    "update invitation set sent_at = clock_timestamp() - $2::interval where public_id = $1",
    [publicId, interval],
  );
}
async function isMember(org: string, actor: string) {
  const result = await owner.sql.query(
    "select 1 from member where organization_id = $1 and user_id = $2",
    [org, actorIds[actor]],
  );
  return result.rows.length > 0;
}

// Holds a transaction that owns the organization row lock, the first lock of
// create, accept, cancel and every role or revoke change.
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
  return { holder, pid, release };
}
// Waits until `count` backends are blocked, directly or through an earlier
// waiter, by this holder's transaction. A second waiter queues behind the first
// waiter's tuple lock, so the chain is followed from the holder; sessions of
// other tests are never part of it.
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

beforeAll(async () => {
  await runMigrations({ url: ownerUrl, migrationsDir });
  await owner.sql.query(
    `insert into organization (id, name, slug) values
       ($1, 'Resend A', $2), ($3, 'Resend B', $4), ($5, 'Resend Full', $6)`,
    [
      orgA,
      `resend-a-${run}`,
      orgB,
      `resend-b-${run}`,
      orgFull,
      `resend-f-${run}`,
    ],
  );
  for (const [name, id] of Object.entries(actorIds)) {
    await owner.sql.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, $2, $3, true, now(), now())`,
      [id, name, email(name.toLowerCase())],
    );
  }
  for (const role of roles) {
    for (const [org, suffix] of [
      [orgA, "A"],
      [orgB, "B"],
    ] as const) {
      await owner.sql.query(
        "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, $4)",
        [crypto.randomUUID(), org, actorIds[`${role}${suffix}`], role],
      );
    }
  }
  await owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')",
    [crypto.randomUUID(), orgFull, actorIds.fullOwner],
  );
}, 120_000);

beforeEach(() => {
  mail.length = 0;
  attempts = 0;
  smtpFails = false;
  linkCommittedAtSend.length = 0;
});

// A failed assertion must not leave a lock held for the next test.
afterEach(async () => {
  await Promise.all(openHolders.splice(0).map((release) => release()));
});

afterAll(async () => {
  await owner.sql.query("delete from organization where id = any($1::uuid[])", [
    [orgA, orgB, orgFull],
  ]);
  await owner.sql.query('delete from "user" where id = any($1::text[])', [
    Object.values(actorIds),
  ]);
  await owner.close();
  await runtime.close();
});

const ownerRowEmail = (label: string) => email(`owner-${label}`);

async function seedLive(org: string, count: number) {
  await owner.sql.query(
    `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     select gen_random_uuid()::text, $1, 'live-' || n || $2, 'viewer', 'pending', $3,
            now() + interval '1 day', now(), now()
     from generate_series(1, $4::int) n`,
    [org, `-${run}@example.test`, actorIds.fullOwner, count],
  );
}
async function clearInvitations(org: string) {
  await owner.sql.query("delete from invitation where organization_id = $1", [
    org,
  ]);
}
async function activeCountOf(actor: string, org: string) {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    headers: { "x-test-actor": actor },
  });
  return ((await response.json()) as { activeCount: number }).activeCount;
}
// Queues `first` then `second` behind a held organization lock, so `first`
// takes the lock before `second` once the holder commits.
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

describe("POST /api/organizations/:organizationId/invitations/:publicId/resend", () => {
  it("allows owner for every invitation role and admin for all but owner, rotating the id in both organizations", async () => {
    let sent = 0;
    for (const [org, suffix] of [
      [orgA, "A"],
      [orgB, "B"],
    ] as const) {
      for (const actorRole of roles) {
        for (const invitationRole of roles) {
          const address = email(`m-${suffix}-${actorRole}-${invitationRole}`);
          const row = await seed(org, address, { role: invitationRole });
          mail.length = 0;
          const result = await resend(
            `${actorRole}${suffix}`,
            org,
            row.publicId,
          );
          const allowed =
            actorRole === "owner" ||
            (actorRole === "admin" && invitationRole !== "owner");
          const after = await rowOf(row.publicId);
          if (allowed) {
            expect(result.status, `${actorRole} -> ${invitationRole}`).toBe(
              200,
            );
            expect(result.body).toMatchObject({
              resent: true,
              emailDispatch: "accepted",
            });
            expect(after.id).not.toBe(row.id);
            expect(after.status).toBe("pending");
            expect(await rowCount(org, address)).toBe(1);
            expect(mail).toHaveLength(1);
            expect(mail[0]?.to).toBe(address);
            expect(mail[0]?.text).toContain(after.id);
            expect(mail[0]?.text).not.toContain(row.id);
            sent += 1;
          } else {
            expect(result.status, `${actorRole} -> ${invitationRole}`).toBe(
              403,
            );
            expect(result.body).toMatchObject({
              error: { code: "PERMISSION_DENIED" },
            });
            expect(after.id).toBe(row.id);
            expect(mail).toHaveLength(0);
          }
        }
      }
    }
    // Per organization: owner sends 4, admin sends 3.
    expect(sent).toBe(14);
    expect(linkCommittedAtSend).toHaveLength(14);
    expect(linkCommittedAtSend.every(Boolean)).toBe(true);
  });

  it("gives admin 404 for an absent publicId and 403 for an owner invitation and sends nothing", async () => {
    const ownerRow = await seed(orgA, ownerRowEmail("admin-probe"), {
      role: "owner",
    });
    expect(
      (await resend("adminA", orgA, crypto.randomUUID())).body,
    ).toMatchObject({ error: { code: "INVITATION_NOT_FOUND" } });
    expect(await resend("adminA", orgA, ownerRow.publicId)).toMatchObject({
      status: 403,
      body: { error: { code: "PERMISSION_DENIED" } },
    });
    expect((await rowOf(ownerRow.publicId)).id).toBe(ownerRow.id);
    expect(attempts).toBe(0);
  });

  it("answers viewer and auditor 403 before the lookup, equal for existing and absent publicIds", async () => {
    const row = await seed(orgA, email("probe"));
    for (const actor of ["viewerA", "auditorA"]) {
      const existing = await resend(actor, orgA, row.publicId);
      const absent = await resend(actor, orgA, crypto.randomUUID());
      expect(existing.status).toBe(403);
      expect(existing).toEqual(absent);
      expect(existing.body).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
    }
    expect((await rowOf(row.publicId)).id).toBe(row.id);
    expect(attempts).toBe(0);
  });

  it("answers a non-member 403 MEMBERSHIP_DENIED, equal for a present, absent publicId and absent organization", async () => {
    const row = await seed(orgA, email("outsider-probe"));
    const present = await resend("outsider", orgA, row.publicId);
    expect(present.status).toBe(403);
    expect(present.body).toMatchObject({
      error: { code: "MEMBERSHIP_DENIED" },
    });
    expect(present).toEqual(
      await resend("outsider", orgA, crypto.randomUUID()),
    );
    expect(present).toEqual(
      await resend("outsider", absentOrg, crypto.randomUUID()),
    );
    expect(await resend("ownerA", orgB, row.publicId)).toEqual(present);
    expect((await rowOf(row.publicId)).id).toBe(row.id);
    expect(attempts).toBe(0);
  });

  it("returns 404 for a publicId of B in A's URL and leaves B untouched", async () => {
    const inB = await seed(orgB, email("b-row"));
    expect(await resend("ownerA", orgA, inB.publicId)).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await resend("ownerB", orgA, inB.publicId)).toMatchObject({
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED" } },
    });
    expect((await rowOf(inB.publicId)).id).toBe(inB.id);
    expect(attempts).toBe(0);
  });

  it("returns 404 for a row that is not pending without sending", async () => {
    for (const status of ["accepted", "canceled", "rejected"]) {
      const row = await seed(orgA, email(`status-${status}`), { status });
      expect(await resend("ownerA", orgA, row.publicId)).toMatchObject({
        status: 404,
        body: { error: { code: "INVITATION_NOT_FOUND" } },
      });
      expect((await rowOf(row.publicId)).id).toBe(row.id);
    }
    expect(attempts).toBe(0);
  });

  it("rejects a malformed publicId with 400 and an unauthenticated request with 401", async () => {
    const malformed = await app.request(
      `/api/organizations/${orgA}/invitations/not-a-uuid/resend`,
      { method: "POST", headers: { "x-test-actor": "ownerA" } },
    );
    expect(malformed.status).toBe(400);
    const anonymous = await app.request(
      `/api/organizations/${orgA}/invitations/${crypto.randomUUID()}/resend`,
      { method: "POST" },
    );
    expect(anonymous.status).toBe(401);
  });

  it("kills the old link, keeps publicId, grants 48 hours and does not make the recipient a member", async () => {
    const address = email("invitee1");
    const row = await seed(orgA, address);
    expect(await previewStatus(row.id)).toBe(200);
    const result = await resend("ownerA", orgA, row.publicId);
    expect(result.status).toBe(200);
    const after = await rowOf(row.publicId);
    expect(after.id).not.toBe(row.id);
    expect(after.lifetimeSeconds).toBe(48 * 3600);
    expect(await previewStatus(row.id)).toBe(404);
    expect(await previewStatus(after.id)).toBe(200);
    const unknown = crypto.randomUUID();
    const oldAccept = await accept("invitee1", row.id);
    expect(oldAccept.status).toBe(404);
    expect(oldAccept).toEqual(await accept("invitee1", unknown));
    expect(await isMember(orgA, "invitee1")).toBe(false);
    const body = result.body as {
      sentAt: string;
      expiresAt: string;
      resendAvailableAt: string;
    };
    expect(Date.parse(body.expiresAt) - Date.parse(body.sentAt)).toBe(
      48 * 3600_000,
    );
    expect(Date.parse(body.resendAvailableAt) - Date.parse(body.sentAt)).toBe(
      300_000,
    );
    expect((await accept("invitee1", after.id)).status).toBe(200);
    expect(await isMember(orgA, "invitee1")).toBe(true);
  });

  it("leaves activeCount and rows per email unchanged when resending a live invitation", async () => {
    const address = email("count-live");
    const row = await seed(orgA, address);
    const before = await activeCountOf("ownerA", orgA);
    expect((await resend("ownerA", orgA, row.publicId)).status).toBe(200);
    expect(await activeCountOf("ownerA", orgA)).toBe(before);
    expect(await rowCount(orgA, address)).toBe(1);
  });

  it("revives an expired invitation: 48 hours from now, back in activeCount", async () => {
    const row = await seed(orgA, email("revive"), { expiresIn: "-1 hour" });
    const before = await activeCountOf("ownerA", orgA);
    expect((await resend("ownerA", orgA, row.publicId)).status).toBe(200);
    expect((await rowOf(row.publicId)).lifetimeSeconds).toBe(48 * 3600);
    expect(await activeCountOf("ownerA", orgA)).toBe(before + 1);
  });

  it("answers 409 USER_ALREADY_MEMBER when the recipient joined before the resend and sends nothing", async () => {
    const row = await seed(orgA, email("joined"));
    await owner.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [crypto.randomUUID(), orgA, actorIds.joined],
    );
    expect(await resend("ownerA", orgA, row.publicId)).toMatchObject({
      status: 409,
      body: { error: { code: "USER_ALREADY_MEMBER" } },
    });
    expect((await rowOf(row.publicId)).id).toBe(row.id);
    expect(attempts).toBe(0);
  });

  it("answers 409 INVITATION_ALREADY_PENDING for a legacy expired row that duplicates a live row", async () => {
    const address = email("legacy-dup");
    const legacy = await seed(orgA, address, { expiresIn: "-1 hour" });
    const live = await seed(orgA, address);
    expect(await resend("ownerA", orgA, legacy.publicId)).toMatchObject({
      status: 409,
      body: { error: { code: "INVITATION_ALREADY_PENDING" } },
    });
    expect((await rowOf(legacy.publicId)).id).toBe(legacy.id);
    expect((await rowOf(live.publicId)).id).toBe(live.id);
    expect(attempts).toBe(0);
  });

  it("resends an expired invitation at 99 live rows and refuses at 100", async () => {
    await clearInvitations(orgFull);
    await seedLive(orgFull, 99);
    const expired = await seed(orgFull, email("full-expired"), {
      expiresIn: "-1 hour",
    });
    expect((await resend("fullOwner", orgFull, expired.publicId)).status).toBe(
      200,
    );
    expect(await activeCountOf("fullOwner", orgFull)).toBe(100);
    await clearInvitations(orgFull);
    await seedLive(orgFull, 100);
    const blocked = await seed(orgFull, email("full-blocked"), {
      expiresIn: "-1 hour",
    });
    mail.length = 0;
    attempts = 0;
    expect(await resend("fullOwner", orgFull, blocked.publicId)).toMatchObject({
      status: 409,
      body: { error: { code: "INVITATION_LIMIT_REACHED" } },
    });
    expect((await rowOf(blocked.publicId)).id).toBe(blocked.id);
    expect(attempts).toBe(0);
    expect(await activeCountOf("fullOwner", orgFull)).toBe(100);
    await clearInvitations(orgFull);
  });

  it("still lets a live invitation be resent while 100 live rows exist", async () => {
    await clearInvitations(orgFull);
    await seedLive(orgFull, 99);
    const live = await seed(orgFull, email("full-live"));
    expect((await resend("fullOwner", orgFull, live.publicId)).status).toBe(
      200,
    );
    expect(await activeCountOf("fullOwner", orgFull)).toBe(100);
    await clearInvitations(orgFull);
  });
});

describe("resend cooldown", () => {
  async function expectCooldown(publicId: string, previousId: string) {
    await setSentAgo(publicId, "299 seconds");
    const blocked = await resend("ownerA", orgA, publicId);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      error: { code: "INVITATION_RESEND_COOLDOWN" },
    });
    const details = (
      blocked.body as { error: { details: { resendAvailableAt: string } } }
    ).error.details;
    expect(Date.parse(details.resendAvailableAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(details.resendAvailableAt)).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
    expect((await rowOf(publicId)).id).toBe(previousId);
    const sent = attempts;
    await setSentAgo(publicId, "300 seconds");
    expect((await resend("ownerA", orgA, publicId)).status).toBe(200);
    expect(attempts).toBe(sent + 1);
    expect((await rowOf(publicId)).id).not.toBe(previousId);
  }

  it("answers 429 at second 299 and passes at 300 after a create", async () => {
    const address = email("cooldown-create");
    expect((await createWith("ownerA", orgA, address)).status).toBe(201);
    const created = await owner.sql.query<{ publicId: string; id: string }>(
      `select public_id as "publicId", id from invitation
       where organization_id = $1 and email = $2`,
      [orgA, address],
    );
    const row = created.rows[0];
    if (!row) throw new Error("created row missing");
    // A fresh create is already cooling down.
    expect((await resend("ownerA", orgA, row.publicId)).status).toBe(429);
    await expectCooldown(row.publicId, row.id);
  });

  it("answers 429 at 299 and passes at 300 after a resend that SMTP accepted", async () => {
    const row = await seed(orgA, email("cooldown-accepted"));
    expect((await resend("ownerA", orgA, row.publicId)).body).toMatchObject({
      emailDispatch: "accepted",
    });
    const current = await rowOf(row.publicId);
    expect((await resend("ownerA", orgA, row.publicId)).status).toBe(429);
    await expectCooldown(row.publicId, current.id);
  });

  it("answers 429 at 299 and passes at 300 after a resend that SMTP rejected, keeping the rotated id", async () => {
    smtpFails = true;
    const row = await seed(orgA, email("cooldown-failed"));
    logs.length = 0;
    const failed = await resend("ownerA", orgA, row.publicId);
    expect(failed).toMatchObject({
      status: 200,
      body: { resent: true, emailDispatch: "failed" },
    });
    const current = await rowOf(row.publicId);
    expect(current.id).not.toBe(row.id);
    const joined = logs.join("\n");
    expect(joined).toContain("organization.invitation.resend.send");
    expect(joined).toContain("SMTP_FAILED");
    for (const secret of [
      email("cooldown-failed"),
      row.id,
      current.id,
      row.publicId,
      orgA,
    ]) {
      expect(joined).not.toContain(secret);
    }
    expect(await previewStatus(row.id)).toBe(404);
    expect(await previewStatus(current.id)).toBe(200);
    expect(attempts).toBe(1);
    smtpFails = false;
    expect((await resend("ownerA", orgA, row.publicId)).status).toBe(429);
    await expectCooldown(row.publicId, current.id);
  });
});

describe("resend logs", () => {
  it("logs denials with actor, action and code only and never an email, id or role", async () => {
    logs.length = 0;
    const row = await seed(orgA, email("log-target"), { role: "owner" });
    await resend("adminA", orgA, row.publicId);
    await resend("viewerA", orgA, row.publicId);
    await resend("outsider", orgA, row.publicId);
    await resend("ownerA", orgA, row.publicId);
    const joined = logs.join("\n");
    const after = await rowOf(row.publicId);
    for (const secret of [
      email("log-target"),
      row.id,
      after.id,
      row.publicId,
      orgA,
      "x-test-actor",
    ]) {
      expect(joined).not.toContain(secret);
    }
    const denials = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "organization access denied");
    expect(denials).toHaveLength(3);
    for (const denial of denials) {
      expect(denial).toMatchObject({
        action: "organization.invitation.resend",
      });
      const pinoBase = ["level", "time", "pid", "hostname", "name", "msg"];
      const fields = Object.keys(denial).filter(
        (key) => !pinoBase.includes(key),
      );
      expect(fields.sort()).toEqual(["action", "actorUserId", "code"]);
    }
    expect(joined).toContain(
      "/api/organizations/:organizationId/invitations/:publicId/resend",
    );
  });
});

describe("resend races on the organization lock", () => {
  it("resend first wins: accept with the old id gets 404 and the new link works", async () => {
    const row = await seed(orgA, email("invitee2"));
    const { first, second } = await raceInOrder(
      orgA,
      () => resend("ownerA", orgA, row.publicId),
      () => accept("invitee2", row.id),
    );
    expect(first.status).toBe(200);
    expect(second).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await isMember(orgA, "invitee2")).toBe(false);
    expect(attempts).toBe(1);
    expect(await previewStatus((await rowOf(row.publicId)).id)).toBe(200);
  });

  it("accept first wins: resend gets 404, sends nothing and the member stays", async () => {
    const row = await seed(orgA, email("invitee3"));
    const { first, second } = await raceInOrder(
      orgA,
      () => accept("invitee3", row.id),
      () => resend("ownerA", orgA, row.publicId),
    );
    expect(first.status).toBe(200);
    expect(second).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await isMember(orgA, "invitee3")).toBe(true);
    expect(attempts).toBe(0);
    expect((await rowOf(row.publicId)).status).toBe("accepted");
  });

  it("sends one email when two resends collide and answers the second 429", async () => {
    const row = await seed(orgA, email("double-resend"));
    const { first, second } = await raceInOrder(
      orgA,
      () => resend("ownerA", orgA, row.publicId),
      () => resend("adminA", orgA, row.publicId),
    );
    expect(first.status).toBe(200);
    expect(second).toMatchObject({
      status: 429,
      body: { error: { code: "INVITATION_RESEND_COOLDOWN" } },
    });
    expect(attempts).toBe(1);
    expect(linkCommittedAtSend).toEqual([true]);
    expect(await rowCount(orgA, email("double-resend"))).toBe(1);
  });

  it("resend first wins: cancel then cancels the rotated row and the new link dies", async () => {
    const row = await seed(orgA, email("resend-cancel"));
    const { first, second } = await raceInOrder(
      orgA,
      () => resend("ownerA", orgA, row.publicId),
      () => cancel("adminA", orgA, row.publicId),
    );
    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 200, body: { canceled: true } });
    const after = await rowOf(row.publicId);
    expect(after.status).toBe("canceled");
    expect(await previewStatus(after.id)).toBe(404);
    expect(attempts).toBe(1);
  });

  it("cancel first wins: resend gets 404 and sends nothing", async () => {
    const row = await seed(orgA, email("cancel-resend"));
    const { first, second } = await raceInOrder(
      orgA,
      () => cancel("ownerA", orgA, row.publicId),
      () => resend("adminA", orgA, row.publicId),
    );
    expect(first.status).toBe(200);
    expect(second).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect((await rowOf(row.publicId)).id).toBe(row.id);
    expect(attempts).toBe(0);
  });

  it("reads the actor's role under the lock after a demotion that held it", async () => {
    const row = await seed(orgA, email("demoted"));
    const lock = await holdOrganizationLock(orgA);
    const resending = resend("adminA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 1);
    await lock.holder.query(
      "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
      [orgA, actorIds.adminA],
    );
    await lock.release();
    try {
      expect(await resending).toMatchObject({
        status: 403,
        body: { error: { code: "PERMISSION_DENIED" } },
      });
      expect((await rowOf(row.publicId)).id).toBe(row.id);
      expect(attempts).toBe(0);
    } finally {
      await owner.sql.query(
        "update member set role = 'admin' where organization_id = $1 and user_id = $2",
        [orgA, actorIds.adminA],
      );
    }
  });

  it("reads a revoked actor under the lock as a non-member and writes nothing", async () => {
    const row = await seed(orgA, email("revoked"));
    const lock = await holdOrganizationLock(orgA);
    const resending = resend("adminA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 1);
    await lock.holder.query(
      "delete from member where organization_id = $1 and user_id = $2",
      [orgA, actorIds.adminA],
    );
    await lock.release();
    try {
      expect(await resending).toMatchObject({
        status: 403,
        body: { error: { code: "MEMBERSHIP_DENIED" } },
      });
      expect((await rowOf(row.publicId)).id).toBe(row.id);
      expect(attempts).toBe(0);
    } finally {
      await owner.sql.query(
        "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin')",
        [crypto.randomUUID(), orgA, actorIds.adminA],
      );
    }
  });

  describe("expired resend against create at 99 live rows", () => {
    async function setup() {
      await clearInvitations(orgFull);
      await seedLive(orgFull, 99);
      return seed(orgFull, email("race-expired"), { expiresIn: "-1 hour" });
    }

    it("resend first wins and create gets INVITATION_LIMIT_REACHED", async () => {
      const row = await setup();
      const { first, second } = await raceInOrder(
        orgFull,
        () => resend("fullOwner", orgFull, row.publicId),
        () => createWith("fullOwner", orgFull, email("race-newcomer")),
      );
      expect(first.status).toBe(200);
      expect(second).toMatchObject({
        status: 409,
        body: { error: { code: "INVITATION_LIMIT_REACHED" } },
      });
      expect(attempts).toBe(1);
      expect(await activeCountOf("fullOwner", orgFull)).toBe(100);
      await clearInvitations(orgFull);
    });

    it("create first wins and resend gets INVITATION_LIMIT_REACHED", async () => {
      const row = await setup();
      const { first, second } = await raceInOrder(
        orgFull,
        () => createWith("fullOwner", orgFull, email("race-newcomer")),
        () => resend("fullOwner", orgFull, row.publicId),
      );
      expect(first.status).toBe(201);
      expect(second).toMatchObject({
        status: 409,
        body: { error: { code: "INVITATION_LIMIT_REACHED" } },
      });
      expect(attempts).toBe(1);
      expect((await rowOf(row.publicId)).id).toBe(row.id);
      expect(await activeCountOf("fullOwner", orgFull)).toBe(100);
      await clearInvitations(orgFull);
    });
  });

  describe("expired resend against create for the same email", () => {
    it("create first wins: the expired row is canceled, resend gets 404 and only the create mail is sent", async () => {
      const address = email("same-create-first");
      // Stored with a different case than the lowercase create body.
      const row = await seed(
        orgA,
        address.replace("same", "Same").replace("@example", "@Example"),
        {
          expiresIn: "-1 hour",
        },
      );
      const { first, second } = await raceInOrder(
        orgA,
        () => createWith("ownerA", orgA, address),
        () => resend("ownerA", orgA, row.publicId),
      );
      expect(first.status).toBe(201);
      expect(second).toMatchObject({
        status: 404,
        body: { error: { code: "INVITATION_NOT_FOUND" } },
      });
      expect((await rowOf(row.publicId)).status).toBe("canceled");
      expect(attempts).toBe(1);
      const live = await owner.sql.query(
        "select 1 from invitation where organization_id = $1 and lower(email) = $2 and status = 'pending'",
        [orgA, address],
      );
      expect(live.rows).toHaveLength(1);
    });

    it("resend first wins: create gets INVITATION_ALREADY_PENDING and cancels no row", async () => {
      const address = email("same-resend-first");
      const row = await seed(
        orgA,
        address.replace("same", "Same").replace("@example", "@Example"),
        {
          expiresIn: "-1 hour",
        },
      );
      const { first, second } = await raceInOrder(
        orgA,
        () => resend("ownerA", orgA, row.publicId),
        () => createWith("ownerA", orgA, address),
      );
      expect(first.status).toBe(200);
      expect(second).toMatchObject({
        status: 409,
        body: { error: { code: "INVITATION_ALREADY_PENDING" } },
      });
      expect((await rowOf(row.publicId)).status).toBe("pending");
      expect(attempts).toBe(1);
      const canceled = await owner.sql.query(
        "select 1 from invitation where organization_id = $1 and lower(email) = $2 and status = 'canceled'",
        [orgA, address],
      );
      expect(canceled.rows).toHaveLength(0);
      expect(await rowCount(orgA, address)).toBe(1);
    });
  });
});
