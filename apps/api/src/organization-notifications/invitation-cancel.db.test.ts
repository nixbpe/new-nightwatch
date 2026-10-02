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
  "fullOwner",
];
const actorIds = Object.fromEntries(
  actorNames.map((name) => [name, crypto.randomUUID()]),
) as Record<string, string>;
const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };
const authEnv: AuthEnv = {
  DATABASE_URL: runtimeUrl,
  BETTER_AUTH_SECRET: `cancel-${run}`,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:4000",
  CORS_ORIGIN: "http://localhost:5173",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  SMTP_FROM: "Invitation <invite@example.test>",
};
const mail: OutboundMail[] = [];
const mailer: Mailer = {
  send: (message) => {
    mail.push(message);
    return Promise.resolve();
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
    { level: "info", name: "invitation-cancel-db-test" },
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
async function activeCount(actor: string, org: string) {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    headers: { "x-test-actor": actor },
  });
  return ((await response.json()) as { activeCount: number }).activeCount;
}
async function createInvitation(actor: string, org: string, address: string) {
  const response = await app.request(`/api/organizations/${org}/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-actor": actor },
    body: JSON.stringify({ email: address, role: "viewer" }),
  });
  return response.status;
}
async function seed(
  org: string,
  address: string,
  options: { role?: string; status?: string; expiresIn?: string | null } = {},
) {
  const id = crypto.randomUUID();
  const expiresIn =
    options.expiresIn === undefined ? "1 day" : options.expiresIn;
  const result = await owner.sql.query<{ publicId: string }>(
    `insert into invitation
       (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
     values ($1, $2, $3, $4, $5, $6,
       case when $7::text is null then null else clock_timestamp() + $7::interval end,
       clock_timestamp(), clock_timestamp())
     returning public_id as "publicId"`,
    [
      id,
      org,
      address,
      options.role ?? "viewer",
      options.status ?? "pending",
      actorIds.ownerA,
      expiresIn,
    ],
  );
  return { id, publicId: result.rows[0]?.publicId ?? "" };
}
async function statusOf(publicId: string) {
  return (
    await owner.sql.query<{ status: string }>(
      "select status from invitation where public_id = $1",
      [publicId],
    )
  ).rows[0]?.status;
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
       ($1, 'Cancel A', $2), ($3, 'Cancel B', $4), ($5, 'Cancel Full', $6)`,
    [
      orgA,
      `cancel-a-${run}`,
      orgB,
      `cancel-b-${run}`,
      orgFull,
      `cancel-f-${run}`,
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

describe("DELETE /api/organizations/:organizationId/invitations/:publicId", () => {
  it("allows owner for every invitation role and admin for all but owner in both organizations", async () => {
    for (const [org, suffix] of [
      [orgA, "A"],
      [orgB, "B"],
    ] as const) {
      for (const actorRole of roles) {
        for (const invitationRole of roles) {
          const row = await seed(
            org,
            email(`m-${suffix}-${actorRole}-${invitationRole}`),
            { role: invitationRole },
          );
          const result = await cancel(
            `${actorRole}${suffix}`,
            org,
            row.publicId,
          );
          const allowed =
            actorRole === "owner" ||
            (actorRole === "admin" && invitationRole !== "owner");
          if (allowed) {
            expect(result, `${actorRole} -> ${invitationRole}`).toEqual({
              status: 200,
              body: { canceled: true },
            });
            expect(await statusOf(row.publicId)).toBe("canceled");
          } else {
            expect(result.status, `${actorRole} -> ${invitationRole}`).toBe(
              403,
            );
            expect(result.body).toMatchObject({
              error: { code: "PERMISSION_DENIED" },
            });
            expect(await statusOf(row.publicId)).toBe("pending");
          }
        }
      }
    }
    expect(mail).toHaveLength(0);
  });

  it("gives admin 404 for an absent publicId and 403 for an owner invitation", async () => {
    const ownerRow = await seed(orgA, email("admin-owner-row"), {
      role: "owner",
    });
    expect(
      (await cancel("adminA", orgA, crypto.randomUUID())).body,
    ).toMatchObject({ error: { code: "INVITATION_NOT_FOUND" } });
    expect(await cancel("adminA", orgA, ownerRow.publicId)).toMatchObject({
      status: 403,
      body: { error: { code: "PERMISSION_DENIED" } },
    });
    expect(await statusOf(ownerRow.publicId)).toBe("pending");
  });

  it("answers viewer and auditor 403 before the lookup, equal for existing and absent publicIds", async () => {
    const row = await seed(orgA, email("probe"));
    for (const actor of ["viewerA", "auditorA"]) {
      const existing = await cancel(actor, orgA, row.publicId);
      const absent = await cancel(actor, orgA, crypto.randomUUID());
      expect(existing.status).toBe(403);
      expect(existing).toEqual(absent);
      expect(existing.body).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
    }
    expect(await statusOf(row.publicId)).toBe("pending");
  });

  it("answers a non-member 403 MEMBERSHIP_DENIED, equal for a present, absent publicId and absent organization", async () => {
    const row = await seed(orgA, email("outsider-probe"));
    const present = await cancel("outsider", orgA, row.publicId);
    expect(present.status).toBe(403);
    expect(present.body).toMatchObject({
      error: { code: "MEMBERSHIP_DENIED" },
    });
    expect(present).toEqual(
      await cancel("outsider", orgA, crypto.randomUUID()),
    );
    expect(present).toEqual(
      await cancel("outsider", absentOrg, crypto.randomUUID()),
    );
    // A member of A only is a non-member of B.
    expect(await cancel("ownerA", orgB, row.publicId)).toEqual(present);
    expect(await statusOf(row.publicId)).toBe("pending");
  });

  it("returns 404 for a publicId of B in A's URL and leaves B untouched", async () => {
    const inB = await seed(orgB, email("b-row"));
    expect(await cancel("ownerA", orgA, inB.publicId)).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await cancel("ownerB", orgA, inB.publicId)).toMatchObject({
      status: 403,
      body: { error: { code: "MEMBERSHIP_DENIED" } },
    });
    expect(await statusOf(inB.publicId)).toBe("pending");
    expect((await cancel("ownerB", orgB, inB.publicId)).status).toBe(200);
  });

  it("returns 404 for a row that is not pending and cancels expired and never-expiring rows", async () => {
    for (const status of ["accepted", "canceled", "rejected"]) {
      const row = await seed(orgA, email(`status-${status}`), { status });
      expect(await cancel("ownerA", orgA, row.publicId)).toMatchObject({
        status: 404,
        body: { error: { code: "INVITATION_NOT_FOUND" } },
      });
      expect(await statusOf(row.publicId)).toBe(status);
    }
    for (const expiresIn of ["-1 hour", null]) {
      const row = await seed(orgA, email(`expired-${String(expiresIn)}`), {
        expiresIn,
      });
      expect((await cancel("ownerA", orgA, row.publicId)).status).toBe(200);
      expect(await statusOf(row.publicId)).toBe("canceled");
    }
  });

  it("rejects a malformed publicId with 400 and an unauthenticated request with 401", async () => {
    const malformed = await app.request(
      `/api/organizations/${orgA}/invitations/not-a-uuid`,
      { method: "DELETE", headers: { "x-test-actor": "ownerA" } },
    );
    expect(malformed.status).toBe(400);
    const anonymous = await app.request(
      `/api/organizations/${orgA}/invitations/${crypto.randomUUID()}`,
      { method: "DELETE" },
    );
    expect(anonymous.status).toBe(401);
  });

  it("makes the old link answer like an unknown id for preview and accept, and lets the email be invited again", async () => {
    const address = email("invitee1");
    const row = await seed(orgA, address);
    expect(await previewStatus(row.id)).toBe(200);
    expect((await cancel("ownerA", orgA, row.publicId)).status).toBe(200);
    expect(await previewStatus(row.id)).toBe(404);
    const unknown = crypto.randomUUID();
    expect(await previewStatus(unknown)).toBe(404);
    const canceledAccept = await accept("invitee1", row.id);
    expect(canceledAccept.status).toBe(404);
    expect(canceledAccept).toEqual(await accept("invitee1", unknown));
    expect(await isMember(orgA, "invitee1")).toBe(false);
    expect(await createInvitation("ownerA", orgA, address)).toBe(201);
    expect(mail).toHaveLength(1);
    mail.length = 0;
  });

  it("returns activeCount from 100 to 99 and frees a slot for a new invitation", async () => {
    await owner.sql.query(
      `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
       select gen_random_uuid()::text, $1, 'full-' || n || $2, 'viewer', 'pending', $3,
              now() + interval '1 day', now(), now()
       from generate_series(1, 100) n`,
      [orgFull, `-${run}@example.test`, actorIds.fullOwner],
    );
    expect(await activeCount("fullOwner", orgFull)).toBe(100);
    expect(await createInvitation("fullOwner", orgFull, email("extra"))).toBe(
      409,
    );
    const victim = await owner.sql.query<{ publicId: string }>(
      `select public_id as "publicId" from invitation
       where organization_id = $1 order by email limit 1`,
      [orgFull],
    );
    const publicId = victim.rows[0]?.publicId ?? "";
    expect((await cancel("fullOwner", orgFull, publicId)).status).toBe(200);
    expect(await activeCount("fullOwner", orgFull)).toBe(99);
    expect(await createInvitation("fullOwner", orgFull, email("extra"))).toBe(
      201,
    );
    expect(await activeCount("fullOwner", orgFull)).toBe(100);
    mail.length = 0;
  });

  it("logs denials with actor, action and code only and never an email, id or role", async () => {
    logs.length = 0;
    const row = await seed(orgA, email("log-target"), { role: "owner" });
    await cancel("adminA", orgA, row.publicId);
    await cancel("viewerA", orgA, row.publicId);
    await cancel("outsider", orgA, row.publicId);
    await cancel("ownerA", orgA, row.publicId);
    const joined = logs.join("\n");
    for (const secret of [
      email("log-target"),
      row.id,
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
        action: "organization.invitation.cancel",
      });
      const pinoBase = ["level", "time", "pid", "hostname", "name", "msg"];
      const fields = Object.keys(denial).filter(
        (key) => !pinoBase.includes(key),
      );
      expect(fields.sort()).toEqual(["action", "actorUserId", "code"]);
    }
    expect(denials.map((entry) => entry.code)).toEqual([
      "PERMISSION_DENIED",
      "PERMISSION_DENIED",
      "MEMBERSHIP_DENIED",
    ]);
    expect(joined).toContain(
      "/api/organizations/:organizationId/invitations/:publicId",
    );
  });
});

describe("cancel races on the organization lock", () => {
  it("accept first wins and cancel then gets 404, the member keeps the role", async () => {
    const row = await seed(orgA, email("invitee2"));
    const lock = await holdOrganizationLock(orgA);
    const accepting = accept("invitee2", row.id);
    await waitUntilQueued(lock.pid, 1);
    const canceling = cancel("ownerA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 2);
    await lock.release();
    expect((await accepting).status).toBe(200);
    expect(await canceling).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await statusOf(row.publicId)).toBe("accepted");
    expect(await isMember(orgA, "invitee2")).toBe(true);
  });

  it("cancel first wins and accept then gets 404 without a membership", async () => {
    const row = await seed(orgA, email("invitee3"));
    const lock = await holdOrganizationLock(orgA);
    const canceling = cancel("ownerA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 1);
    const accepting = accept("invitee3", row.id);
    await waitUntilQueued(lock.pid, 2);
    await lock.release();
    expect(await canceling).toEqual({ status: 200, body: { canceled: true } });
    expect(await accepting).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await statusOf(row.publicId)).toBe("canceled");
    expect(await isMember(orgA, "invitee3")).toBe(false);
  });

  it("lets the first of two cancels win with 200 and answers the second 404", async () => {
    const row = await seed(orgA, email("double-cancel"));
    const lock = await holdOrganizationLock(orgA);
    const first = cancel("ownerA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 1);
    const second = cancel("adminA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 2);
    await lock.release();
    expect(await first).toEqual({ status: 200, body: { canceled: true } });
    expect(await second).toMatchObject({
      status: 404,
      body: { error: { code: "INVITATION_NOT_FOUND" } },
    });
    expect(await statusOf(row.publicId)).toBe("canceled");
  });

  it("reads the actor's role under the lock after a demotion that held it", async () => {
    const row = await seed(orgA, email("demoted"));
    const lock = await holdOrganizationLock(orgA);
    const canceling = cancel("adminA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 1);
    await lock.holder.query(
      "update member set role = 'viewer' where organization_id = $1 and user_id = $2",
      [orgA, actorIds.adminA],
    );
    await lock.release();
    try {
      expect(await canceling).toMatchObject({
        status: 403,
        body: { error: { code: "PERMISSION_DENIED" } },
      });
      expect(await statusOf(row.publicId)).toBe("pending");
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
    const canceling = cancel("adminA", orgA, row.publicId);
    await waitUntilQueued(lock.pid, 1);
    await lock.holder.query(
      "delete from member where organization_id = $1 and user_id = $2",
      [orgA, actorIds.adminA],
    );
    await lock.release();
    try {
      expect(await canceling).toMatchObject({
        status: 403,
        body: { error: { code: "MEMBERSHIP_DENIED" } },
      });
      expect(await statusOf(row.publicId)).toBe("pending");
    } finally {
      await owner.sql.query(
        "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'admin')",
        [crypto.randomUUID(), orgA, actorIds.adminA],
      );
    }
  });
});
