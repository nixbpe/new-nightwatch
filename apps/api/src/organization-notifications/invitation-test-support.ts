import { createDatabase, runMigrations, type Database } from "@nightwatch/db";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";

export function createInvitationFixture(actorNames: string[]) {
  const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
  const runtime = createDatabase(runtimeUrl);
  const owner = createDatabase(ownerUrl);
  const run = crypto.randomUUID();
  const actorIds: Record<string, string> = Object.fromEntries(
    actorNames.map((name) => [name, crypto.randomUUID()]),
  );
  const email = (label: string) => `${label}-${run}@example.test`;
  return {
    runtimeUrl,
    ownerUrl,
    runtime,
    owner,
    run,
    actorIds,
    email,
    async initialize(
      organizations: [id: string, name: string, slug: string][],
      memberships: [organizationId: string, actor: string, role: string][],
      actorEmail = email,
    ) {
      await runMigrations({
        url: ownerUrl,
        migrationsDir: fileURLToPath(
          new URL("../../../../packages/db/migrations", import.meta.url),
        ),
      });
      for (const organization of organizations) {
        await owner.sql.query(
          "insert into organization (id, name, slug) values ($1, $2, $3)",
          organization,
        );
      }
      for (const [name, id] of Object.entries(actorIds)) {
        await owner.sql.query(
          `insert into "user" (id, name, email, email_verified, created_at, updated_at)
           values ($1, $2, $3, true, now(), now())`,
          [id, name, actorEmail(name)],
        );
      }
      for (const [org, actor, role] of memberships) {
        await owner.sql.query(
          "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, $4)",
          [crypto.randomUUID(), org, actorIds[actor], role],
        );
      }
    },
    async close(organizationIds: string[]) {
      await owner.sql.query(
        "delete from organization where id = any($1::uuid[])",
        [organizationIds],
      );
      await owner.sql.query('delete from "user" where id = any($1::text[])', [
        Object.values(actorIds),
      ]);
      await owner.close();
      await runtime.close();
    },
  };
}

// Each suite selects its original clock expressions, including subtraction by
// zero for List and no subtraction for Cancel. Undefined expiry is not null.
export function invitationSeed(
  owner: Database,
  inviterId: string | undefined,
  defaults: { sentAgo?: string; backdateCreated?: boolean } = {},
) {
  return async (
    org: string,
    address: string,
    options: {
      role?: string;
      status?: string;
      expiresIn?: string | null;
      sentAgo?: string;
    } = {},
  ) => {
    const id = crypto.randomUUID();
    const expiresIn =
      options.expiresIn === undefined ? "1 day" : options.expiresIn;
    const result = await owner.sql.query<{ publicId: string }>(
      `insert into invitation
         (id, organization_id, email, role, status, inviter_id, expires_at, created_at, sent_at)
       values ($1, $2, $3, $4, $5, $6,
         case when $7::text is null then null else clock_timestamp() + $7::interval end,
         case when $9::boolean then clock_timestamp() - $8::interval else clock_timestamp() end,
         case when $8::text is null then clock_timestamp() else clock_timestamp() - $8::interval end)
       returning public_id as "publicId"`,
      [
        id,
        org,
        address,
        options.role ?? "viewer",
        options.status ?? "pending",
        inviterId,
        expiresIn,
        options.sentAgo ?? defaults.sentAgo ?? null,
        defaults.backdateCreated ?? false,
      ],
    );
    return { id, publicId: result.rows[0]?.publicId ?? "" };
  };
}

export function invitationLocks(
  owner: Database,
  ownerUrl: string,
  openHolders: (() => Promise<void>)[],
) {
  return {
    // Caller owns the rollback list and drains it in its afterEach hook.
    holdOrganizationLock: async (org: string) => {
      const holder = new Client({ connectionString: ownerUrl });
      await holder.connect();
      const pid = (
        await holder.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]?.pid;
      if (pid === undefined) throw new Error("no backend pid");
      await holder.query("begin");
      await holder.query(
        "select id from organization where id = $1 for update",
        [org],
      );
      let released = false;
      const release = async (action: "commit" | "rollback" = "commit") => {
        if (released) return;
        released = true;
        await holder.query(action);
        await holder.end();
      };
      openHolders.push(() => release("rollback"));
      return { holder, pid, release };
    },
    // Follow the recursive blocker chain: a second waiter can queue behind
    // the first waiter's tuple lock rather than directly behind the holder.
    waitUntilQueued: async (holderPid: number, count: number) => {
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
    },
  };
}
