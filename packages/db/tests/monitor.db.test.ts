import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimDueMonitorChecks,
  createDatabase,
  ensureMonitorPartitions,
  purgeExpiredMonitorData,
  runMigrations,
  withTenantContextRaw,
} from "../src";

const runtimeUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_OWNER_URL;

if (!runtimeUrl || !ownerUrl) {
  throw new Error(
    "monitor database tests require DATABASE_URL and DATABASE_OWNER_URL",
  );
}

// This file creates and drops monitor partitions, which lock the parent
// tables against every other suite that deletes organizations or calls
// ensure_monitor_partitions on the shared database (deadlocks, dropped
// fixtures). It therefore runs in its own database on the same cluster.
const databaseName = `monitor_db_${randomUUID().replaceAll("-", "")}`;
const isolatedOwnerUrl = new URL(ownerUrl);
isolatedOwnerUrl.pathname = `/${databaseName}`;
const isolatedRuntimeUrl = new URL(runtimeUrl);
isolatedRuntimeUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: ownerUrl });
let adminConnected = false;
let migrationsCopyDir: string | undefined;
const database = createDatabase(isolatedRuntimeUrl.toString());
const ownerDatabase = createDatabase(isolatedOwnerUrl.toString());
const owner = new Client({ connectionString: isolatedOwnerUrl.toString() });
const run = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
let ownerConnected = false;

const MONITOR_TABLES = [
  "monitors",
  "monitor_secrets",
  "monitor_schedule",
  "monitor_check_results",
  "monitor_check_hourly",
  "monitor_incidents",
  "monitor_events",
  "monitor_last_responses",
] as const;

type Seeded = { monitorId: string };

async function insertMonitor(
  client: PoolClient | Client,
  tenantId: string,
  input: {
    id?: string;
    intervalSeconds?: number;
    timeoutSeconds?: number;
  } = {},
): Promise<string> {
  const id = input.id ?? randomUUID();
  await client.query(
    `insert into monitors
       (id, tenant_id, name, url, interval_seconds, timeout_seconds, client_request_id)
     values ($1, $2, $3, 'https://target.example.test/health', $4, $5, $6)`,
    [
      id,
      tenantId,
      `monitor-${run}`,
      input.intervalSeconds ?? 60,
      input.timeoutSeconds ?? 10,
      randomUUID(),
    ],
  );
  return id;
}

async function insertSchedule(
  client: PoolClient | Client,
  tenantId: string,
  monitorId: string,
  nextCheckAt: string | null,
): Promise<void> {
  await client.query(
    `insert into monitor_schedule
       (monitor_id, tenant_id, next_check_at, check_config_version,
        interval_seconds, timeout_seconds)
     values ($1, $2, $3::timestamptz, 1, 120, 20)`,
    [monitorId, tenantId, nextCheckAt],
  );
}

/** One row in every monitor table for the tenant, through the runtime role. */
async function seedTenant(tenantId: string): Promise<Seeded> {
  return withTenantContextRaw(database, tenantId, async (client) => {
    const monitorId = await insertMonitor(client, tenantId);
    await insertSchedule(client, tenantId, monitorId, null);
    await client.query(
      `insert into monitor_secrets
         (monitor_id, tenant_id, slot, ciphertext, iv, auth_tag, key_version)
       values ($1, $2, 'auth.token', '\\x01', '\\x02', '\\x03', '1')`,
      [monitorId, tenantId],
    );
    await client.query(
      `insert into monitor_check_results
         (monitor_id, tenant_id, scheduled_for, checked_at, outcome,
          url_masked, check_config_version, interval_seconds)
       values ($1, $2, now(), now(), 'pass', 'https://target.example.test/', 1, 60)`,
      [monitorId, tenantId],
    );
    await client.query(
      `insert into monitor_check_hourly
         (monitor_id, tenant_id, hour_start, checks, passed, covered_seconds)
       values ($1, $2, date_trunc('hour', now()), 1, 1, 60)`,
      [monitorId, tenantId],
    );
    await client.query(
      `insert into monitor_incidents
         (monitor_id, tenant_id, started_at, start_reason)
       values ($1, $2, now(), 'http_status')`,
      [monitorId, tenantId],
    );
    await client.query(
      `insert into monitor_events (monitor_id, tenant_id, kind)
       values ($1, $2, 'paused')`,
      [monitorId, tenantId],
    );
    await client.query(
      `insert into monitor_last_responses
         (monitor_id, tenant_id, scheduled_for, checked_at, config_version,
          outcome, url_masked)
       values ($1, $2, now(), now(), 1, 'pass', 'https://target.example.test/')`,
      [monitorId, tenantId],
    );
    return { monitorId };
  });
}

async function countRows(
  client: PoolClient,
  table: (typeof MONITOR_TABLES)[number],
  monitorIds: string[],
): Promise<number> {
  const column = table === "monitors" ? "id" : "monitor_id";
  const result = await client.query<{ n: string }>(
    `select count(*) as n from ${table} where ${column} = any($1::uuid[])`,
    [monitorIds],
  );
  return Number(result.rows[0]?.n);
}

async function ownerCount(
  table: string,
  monitorIds: string[],
): Promise<number> {
  const column = table === "monitors" ? "id" : "monitor_id";
  const result = await owner.query<{ n: string }>(
    `select count(*) as n from ${table} where ${column} = any($1::uuid[])`,
    [monitorIds],
  );
  return Number(result.rows[0]?.n);
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

let seededA: Seeded;
let seededB: Seeded;

/** Copies the migrations with `create role` made idempotent: roles are
 * cluster-global and already exist once any NightWatch database on the
 * cluster has been migrated (architecture DB-13). */
async function copyMigrationsWithIdempotentRoles(): Promise<string> {
  const source = new URL("../migrations", import.meta.url).pathname;
  const target = await mkdtemp(
    join(tmpdir(), "nightwatch-monitor-migrations-"),
  );
  for (const name of await readdir(source)) {
    const sql = (await readFile(join(source, name), "utf8")).replace(
      /create role (\w+)([^;]*);/g,
      (_match, role: string, options: string) =>
        `do $role$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role}${options}; end if; end $role$;`,
    );
    await writeFile(join(target, name), sql);
  }
  return target;
}

beforeAll(async () => {
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database ${databaseName}`);
  await admin.query(
    `grant connect, temporary on database ${databaseName} to nightwatch`,
  );
  migrationsCopyDir = await copyMigrationsWithIdempotentRoles();
  await runMigrations({
    url: isolatedOwnerUrl.toString(),
    migrationsDir: migrationsCopyDir,
    log: () => undefined,
  });
  await owner.connect();
  ownerConnected = true;
  await owner.query(
    `insert into organization (id, name, slug)
     values ($1, 'Monitor A', $2), ($3, 'Monitor B', $4)`,
    [tenantA, `monitor-a-${run}`, tenantB, `monitor-b-${run}`],
  );
  seededA = await seedTenant(tenantA);
  seededB = await seedTenant(tenantB);
}, 120_000);

afterAll(async () => {
  try {
    await database.close();
    await ownerDatabase.close();
    if (ownerConnected) await owner.end();
  } finally {
    try {
      if (adminConnected) {
        try {
          await admin.query(`drop database if exists ${databaseName}`);
        } catch {
          await admin.query(
            `select pg_terminate_backend(pid) from pg_stat_activity
             where datname = $1 and pid <> pg_backend_pid()`,
            [databaseName],
          );
          await admin.query(`drop database if exists ${databaseName}`);
        }
      }
    } finally {
      await admin.end().catch(() => undefined);
      if (migrationsCopyDir) {
        await rm(migrationsCopyDir, { recursive: true, force: true });
      }
    }
  }
}, 60_000);

describe("monitor tenant isolation", () => {
  it.each(MONITOR_TABLES)(
    "%s shows each tenant only its own rows (A-only, B-only)",
    async (table) => {
      const both = [seededA.monitorId, seededB.monitorId];
      const asA = await withTenantContextRaw(database, tenantA, (c) =>
        countRows(c, table, both),
      );
      const asB = await withTenantContextRaw(database, tenantB, (c) =>
        countRows(c, table, both),
      );
      expect(asA).toBe(1);
      expect(asB).toBe(1);
    },
  );

  it.each(MONITOR_TABLES)(
    "%s returns nothing without a tenant context",
    async (table) => {
      const result = await database.sql.query(
        `select 1 from ${table} where tenant_id = any($1::uuid[])`,
        [[tenantA, tenantB]],
      );
      expect(result.rows).toEqual([]);
    },
  );

  it.each(MONITOR_TABLES.filter((t) => t !== "monitors"))(
    "%s rejects writes for tenant B from tenant A context (A+B)",
    async (table) => {
      await expect(
        withTenantContextRaw(database, tenantA, async (client) => {
          // tenant_id = B fails the tenant policy's WITH CHECK.
          await insertChildRow(client, table, tenantB, seededB.monitorId);
        }),
      ).rejects.toThrow(/row-level security/);
    },
  );

  it.each(MONITOR_TABLES.filter((t) => t !== "monitors"))(
    "%s rejects tenant A rows that point at tenant B's monitor",
    async (table) => {
      // RLS passes (tenant_id = A); the composite foreign key must not. The
      // target is a fresh monitor of B so no primary key hides the FK error.
      const bMonitor = await insertMonitor(owner, tenantB);
      await expect(
        withTenantContextRaw(database, tenantA, async (client) => {
          await insertChildRow(client, table, tenantA, bMonitor);
        }),
      ).rejects.toThrow(/foreign key/);
    },
  );

  it("cannot update or delete the other tenant's monitor rows", async () => {
    const outcome = await withTenantContextRaw(
      database,
      tenantA,
      async (client) => {
        const updated = await client.query(
          "update monitors set name = 'hijacked' where id = $1",
          [seededB.monitorId],
        );
        const deleted = await client.query(
          "delete from monitors where id = $1",
          [seededB.monitorId],
        );
        return [updated.rowCount, deleted.rowCount];
      },
    );
    expect(outcome).toEqual([0, 0]);
    expect(await ownerCount("monitors", [seededB.monitorId])).toBe(1);
  });

  it("rejects inserting a monitor for tenant B from tenant A context", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        insertMonitor(client, tenantB),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it.each(MONITOR_TABLES)(
    "%s rejects moving a tenant A row to tenant B",
    async (table) => {
      const column = table === "monitors" ? "id" : "monitor_id";
      // results and events have no UPDATE grant, so the grant stops them
      // before RLS; every other table must fail on the policy WITH CHECK.
      const expected =
        table === "monitor_check_results" || table === "monitor_events"
          ? /permission denied/
          : /row-level security/;
      await expect(
        withTenantContextRaw(database, tenantA, (client) =>
          client.query(
            `update ${table} set tenant_id = $1 where ${column} = $2`,
            [tenantB, seededA.monitorId],
          ),
        ),
      ).rejects.toThrow(expected);
    },
  );

  it("grants the runtime role exactly the spec privileges per table", async () => {
    const spec: Record<(typeof MONITOR_TABLES)[number], string> = {
      monitors: "SELECT,INSERT,UPDATE,DELETE",
      monitor_secrets: "SELECT,INSERT,UPDATE,DELETE",
      monitor_schedule: "SELECT,INSERT,UPDATE,DELETE",
      monitor_check_results: "SELECT,INSERT",
      monitor_check_hourly: "SELECT,INSERT,UPDATE",
      monitor_incidents: "SELECT,INSERT,UPDATE",
      monitor_events: "SELECT,INSERT",
      monitor_last_responses: "SELECT,INSERT,UPDATE",
    };
    for (const table of MONITOR_TABLES) {
      const actual: string[] = [];
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const r = await owner.query<{ ok: boolean }>(
          "select has_table_privilege('nightwatch', $1::regclass, $2) as ok",
          [`public.${table}`, privilege],
        );
        if (r.rows[0]?.ok) actual.push(privilege);
      }
      expect({ table, privileges: actual.join(",") }).toEqual({
        table,
        privileges: spec[table],
      });
    }
  });

  it("has no default partition on the partitioned tables", async () => {
    const r = await owner.query<{ relname: string; partdefid: string }>(
      `select c.relname, p.partdefid::text
       from pg_partitioned_table p join pg_class c on c.oid = p.partrelid
       where c.relname in ('monitor_check_results', 'monitor_check_hourly')`,
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((row) => row.partdefid)).toEqual(["0", "0"]);
  });

  it("denies runtime writes the grants do not include", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query("update monitor_check_results set outcome = 'fail'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query("delete from monitor_events"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("allows only one open incident per monitor", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          `insert into monitor_incidents
             (monitor_id, tenant_id, started_at, start_reason)
           values ($1, $2, now(), 'timeout')`,
          [seededA.monitorId, tenantA],
        ),
      ),
    ).rejects.toThrow(/monitor_incidents_one_open_key/);
  });
});

async function insertChildRow(
  client: PoolClient,
  table: string,
  tenantId: string,
  monitorId: string,
): Promise<void> {
  switch (table) {
    case "monitor_secrets":
      await client.query(
        `insert into monitor_secrets
           (monitor_id, tenant_id, slot, ciphertext, iv, auth_tag, key_version)
         values ($1, $2, 'auth.password', '\\x01', '\\x02', '\\x03', '1')`,
        [monitorId, tenantId],
      );
      return;
    case "monitor_schedule":
      await client.query(
        `insert into monitor_schedule
           (monitor_id, tenant_id, next_check_at, check_config_version,
            interval_seconds, timeout_seconds)
         values ($1, $2, null, 1, 60, 10)`,
        [monitorId, tenantId],
      );
      return;
    case "monitor_check_results":
      await client.query(
        `insert into monitor_check_results
           (monitor_id, tenant_id, scheduled_for, checked_at, outcome,
            url_masked, check_config_version, interval_seconds)
         values ($1, $2, now() - interval '1 hour', now(), 'pass', 'u', 1, 60)`,
        [monitorId, tenantId],
      );
      return;
    case "monitor_check_hourly":
      await client.query(
        `insert into monitor_check_hourly (monitor_id, tenant_id, hour_start)
         values ($1, $2, date_trunc('hour', now()) - interval '1 hour')`,
        [monitorId, tenantId],
      );
      return;
    case "monitor_incidents":
      await client.query(
        `insert into monitor_incidents
           (monitor_id, tenant_id, started_at, ended_at, end_reason, start_reason)
         values ($1, $2, now(), now(), 'recovered', 'timeout')`,
        [monitorId, tenantId],
      );
      return;
    case "monitor_events":
      await client.query(
        `insert into monitor_events (monitor_id, tenant_id, kind)
         values ($1, $2, 'resumed')`,
        [monitorId, tenantId],
      );
      return;
    case "monitor_last_responses":
      await client.query(
        `insert into monitor_last_responses
           (monitor_id, tenant_id, scheduled_for, checked_at, config_version,
            outcome, url_masked)
         values ($1, $2, now(), now(), 1, 'pass', 'u')`,
        [monitorId, tenantId],
      );
      return;
    default:
      throw new Error(`no child insert for ${table}`);
  }
}

describe("monitor_check_hourly response_checks", () => {
  const hour = "date_trunc('hour', now()) - interval '3 days'";

  it("defaults to 0 and separates response-less results from the average", async () => {
    const stats = await withTenantContextRaw(
      database,
      tenantA,
      async (client) => {
        const monitorId = await insertMonitor(client, tenantA);
        const defaults = await client.query<{ response_checks: number }>(
          `insert into monitor_check_hourly (monitor_id, tenant_id, hour_start)
         values ($1, $2, ${hour}) returning response_checks`,
          [monitorId, tenantA],
        );
        // A timeout counts as a check but adds no response time; then a 120 ms
        // and a 80 ms response, each through the upsert the rollup writer uses.
        const upsert = (responseMs: number | null) =>
          client.query(
            `insert into monitor_check_hourly
             (monitor_id, tenant_id, hour_start, checks, response_checks,
              response_ms_sum, response_ms_max)
           values ($1, $2, ${hour}, 1, case when $3::int is null then 0 else 1 end,
                   coalesce($3::int, 0), $3::int)
           on conflict (monitor_id, hour_start) do update set
             checks = monitor_check_hourly.checks + 1,
             response_checks = monitor_check_hourly.response_checks
               + case when $3::int is null then 0 else 1 end,
             response_ms_sum = monitor_check_hourly.response_ms_sum + coalesce($3::int, 0),
             response_ms_max = greatest(monitor_check_hourly.response_ms_max, $3::int)`,
            [monitorId, tenantA, responseMs],
          );
        await upsert(120);
        await upsert(null);
        await upsert(80);
        const row = await client.query<{
          checks: number;
          response_checks: number;
          response_ms_sum: string;
        }>(
          `select checks, response_checks, response_ms_sum from monitor_check_hourly
         where monitor_id = $1`,
          [monitorId],
        );
        return {
          defaults: defaults.rows[0]?.response_checks,
          row: row.rows[0],
        };
      },
    );
    expect(stats.defaults).toBe(0);
    expect(stats.row).toEqual({
      checks: 3,
      response_checks: 2,
      response_ms_sum: "200",
    });
  });

  it.each([
    ["more than checks", 2, 1],
    ["negative", -1, 1],
  ])(
    "rejects response_checks that is %s",
    async (_label, responseChecks, checks) => {
      await expect(
        withTenantContextRaw(database, tenantA, async (client) => {
          const monitorId = await insertMonitor(client, tenantA);
          await client.query(
            `insert into monitor_check_hourly
             (monitor_id, tenant_id, hour_start, checks, response_checks)
           values ($1, $2, ${hour}, $3, $4)`,
            [monitorId, tenantA, checks, responseChecks],
          );
        }),
      ).rejects.toThrow(/monitor_check_hourly_response_checks_check/);
    },
  );
});

describe("monitors config CHECK constraints", () => {
  async function insertWith(
    column: string,
    value: string | number | null,
    cast = "",
  ): Promise<void> {
    const base: Record<string, string> = {
      name: "cfg",
      url: "https://target.example.test/",
    };
    const columns = Object.keys(base).filter((c) => c !== column);
    const values = columns.map((c) => base[c]);
    await withTenantContextRaw(database, tenantA, (client) =>
      client.query(
        `insert into monitors
           (tenant_id, client_request_id, ${[...columns, column].join(", ")})
         values ($1, $2, ${[...columns, column]
           .map(
             (_, i) => `$${String(i + 3)}${i === columns.length ? cast : ""}`,
           )
           .join(", ")})`,
        [tenantA, randomUUID(), ...values, value],
      ),
    );
  }

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])(
    "accepts method %s",
    async (method) => {
      await insertWith("method", method);
    },
  );

  it("rejects an unknown method", async () => {
    await expect(insertWith("method", "TRACE")).rejects.toThrow(
      /monitors_method_check/,
    );
  });

  it.each([
    ["headers", 20, 21],
    ["query_params", 20, 21],
    ["assertions", 10, 11],
    ["expected_status_ranges", 10, 11],
  ] as const)(
    "%s accepts %i entries and rejects %i",
    async (column, ok, over) => {
      const list = (n: number) =>
        JSON.stringify(Array.from({ length: n }, () => ({})));
      await insertWith(column, list(ok), "::jsonb");
      await expect(insertWith(column, list(over), "::jsonb")).rejects.toThrow(
        new RegExp(`monitors_${column}_check`),
      );
    },
  );

  it.each(["headers", "query_params", "assertions", "expected_status_ranges"])(
    "%s must be a JSON array",
    async (column) => {
      await expect(insertWith(column, "{}", "::jsonb")).rejects.toThrow(
        new RegExp(`monitors_${column}_check`),
      );
    },
  );

  it("bounds name, url, body, auth type, body type and timeout", async () => {
    await insertWith("name", "n".repeat(100));
    await expect(insertWith("name", "n".repeat(101))).rejects.toThrow(
      /monitors_name_check/,
    );
    await insertWith("url", `https://t.example.test/${"u".repeat(2048 - 23)}`);
    await expect(
      insertWith("url", `https://t.example.test/${"u".repeat(2048 - 22)}`),
    ).rejects.toThrow(/monitors_url_check/);
    await insertWith("body_content", "b".repeat(65536));
    await expect(insertWith("body_content", "b".repeat(65537))).rejects.toThrow(
      /monitors_body_content_check/,
    );
    for (const type of ["none", "bearer", "basic", "apiKey"]) {
      await insertWith("auth_type", type);
    }
    await expect(insertWith("auth_type", "digest")).rejects.toThrow(
      /monitors_auth_type_check/,
    );
    for (const type of ["json", "text"]) await insertWith("body_type", type);
    await expect(insertWith("body_type", "xml")).rejects.toThrow(
      /monitors_body_type_check/,
    );
    await insertWith("api_key_header_name", "h".repeat(256));
    await expect(
      insertWith("api_key_header_name", "h".repeat(257)),
    ).rejects.toThrow(/monitors_api_key_header_name_check/);
    await insertWith("timeout_seconds", 30);
    await expect(insertWith("timeout_seconds", 31)).rejects.toThrow(
      /monitors_timeout_seconds_check/,
    );
    // default interval is 300 s, so a timeout at or above it violates the pair check
    await expect(insertWith("timeout_seconds", 0)).rejects.toThrow(
      /monitors_timeout_seconds_check/,
    );
  });
});

describe("claim_due_monitor_checks", () => {
  const ancient = "2000-01-01T00:00:00Z";

  async function dueMonitor(
    tenantId: string,
    nextCheckAt: string | null,
  ): Promise<string> {
    return withTenantContextRaw(database, tenantId, async (client) => {
      const id = await insertMonitor(client, tenantId);
      await insertSchedule(client, tenantId, id, nextCheckAt);
      return id;
    });
  }

  /** Claims until a short batch, so leftover due rows cannot crowd the assertions. */
  async function claimAll() {
    const all: Awaited<ReturnType<typeof claimDueMonitorChecks>> = [];
    for (let i = 0; i < 50; i += 1) {
      const batch = await claimDueMonitorChecks(database, { limit: 100 });
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  it("claims due rows across tenants, sets lease and next slot from the ledger", async () => {
    const a = await dueMonitor(tenantA, ancient);
    const b = await dueMonitor(tenantB, ancient);
    const paused = await dueMonitor(tenantA, null);
    const future = await dueMonitor(tenantA, "2999-01-01T00:00:00Z");

    const before = await owner.query<{ t: Date }>(
      "select clock_timestamp() as t",
    );
    const claims = await claimAll();
    const after = await owner.query<{ t: Date }>(
      "select clock_timestamp() as t",
    );

    const mine = claims.filter((c) =>
      [a, b, paused, future].includes(c.monitorId),
    );
    expect(mine.map((c) => c.monitorId).sort()).toEqual([a, b].sort());
    const claimA = must(mine.find((c) => c.monitorId === a));
    expect(claimA.tenantId).toBe(tenantA);
    expect(claimA.checkConfigVersion).toBe(1);
    expect(claimA.scheduledFor.toISOString()).toBe("2000-01-01T00:00:00.000Z");
    expect(claimA.claimToken).toMatch(/^[0-9a-f-]{36}$/);

    const row = await owner.query<{
      claim_token: string;
      next_check_at: Date;
      claimed_until: Date;
    }>(
      `select claim_token, next_check_at, claimed_until
       from monitor_schedule where monitor_id = $1`,
      [a],
    );
    const stored = must(row.rows[0]);
    expect(stored.claim_token).toBe(claimA.claimToken);
    // monitors say 60 s / 10 s, the ledger says 120 s / 20 s: the ledger wins.
    // next = now + 120 s, lease = now + 20 s + 60 s
    const lo = must(before.rows[0]).t.getTime();
    const hi = must(after.rows[0]).t.getTime();
    expect(stored.next_check_at.getTime()).toBeGreaterThanOrEqual(lo + 120_000);
    expect(stored.next_check_at.getTime()).toBeLessThanOrEqual(hi + 120_000);
    expect(stored.claimed_until.getTime()).toBeGreaterThanOrEqual(lo + 80_000);
    expect(stored.claimed_until.getTime()).toBeLessThanOrEqual(hi + 80_000);

    const unclaimed = await owner.query<{ claim_token: string | null }>(
      "select claim_token from monitor_schedule where monitor_id = any($1::uuid[])",
      [[paused, future]],
    );
    expect(unclaimed.rows.map((r) => r.claim_token)).toEqual([null, null]);
  });

  it("does not hand the same row to two concurrent connections", async () => {
    for (let i = 0; i < 6; i += 1) {
      await dueMonitor(tenantA, ancient);
    }
    const first = new Client({
      connectionString: isolatedRuntimeUrl.toString(),
    });
    const second = new Client({
      connectionString: isolatedRuntimeUrl.toString(),
    });
    await first.connect();
    await second.connect();
    try {
      await first.query("begin");
      await second.query("begin");
      const [r1, r2] = await Promise.all([
        first.query<{ monitor_id: string }>(
          "select monitor_id from claim_due_monitor_checks(3)",
        ),
        second.query<{ monitor_id: string }>(
          "select monitor_id from claim_due_monitor_checks(3)",
        ),
      ]);
      const set1 = r1.rows.map((r) => r.monitor_id);
      const set2 = r2.rows.map((r) => r.monitor_id);
      expect(set1).toHaveLength(3);
      expect(set2).toHaveLength(3);
      expect(set1.filter((id) => set2.includes(id))).toEqual([]);
      await first.query("commit");
      await second.query("commit");
    } finally {
      await first.end();
      await second.end();
    }
  });

  it("re-claims only after the lease expires", async () => {
    const id = await dueMonitor(tenantA, ancient);
    const first = await claimAll();
    const firstClaim = must(first.find((c) => c.monitorId === id));

    // Slot is due again but the lease is still live.
    await owner.query(
      "update monitor_schedule set next_check_at = '2000-01-02T00:00:00Z' where monitor_id = $1",
      [id],
    );
    const held = await claimAll();
    expect(held.some((c) => c.monitorId === id)).toBe(false);

    await owner.query(
      "update monitor_schedule set claimed_until = now() - interval '1 second' where monitor_id = $1",
      [id],
    );
    const again = await claimAll();
    const secondClaim = must(again.find((c) => c.monitorId === id));
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);
  });

  it("rejects limits outside 1..100", async () => {
    await expect(
      database.sql.query("select * from claim_due_monitor_checks(0)"),
    ).rejects.toThrow(/between 1 and 100/);
    await expect(
      database.sql.query("select * from claim_due_monitor_checks(101)"),
    ).rejects.toThrow(/between 1 and 100/);
  });

  it("keeps the ledger invisible across tenants to the runtime role", async () => {
    const a = await dueMonitor(tenantA, "2999-01-01T00:00:00Z");
    const b = await dueMonitor(tenantB, "2999-01-01T00:00:00Z");
    const seen = await withTenantContextRaw(database, tenantA, async (c) => {
      const r = await c.query<{ monitor_id: string }>(
        "select monitor_id from monitor_schedule where monitor_id = any($1::uuid[])",
        [[a, b]],
      );
      return r.rows.map((row) => row.monitor_id);
    });
    expect(seen).toEqual([a]);
  });
});

describe("ensure_monitor_partitions", () => {
  const parents = ["monitor_check_results", "monitor_check_hourly"];

  function monthName(parent: string, offset: number): string {
    const now = new Date();
    const month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
    );
    const yyyymm = `${String(month.getUTCFullYear())}${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${parent}_p${yyyymm}`;
  }

  async function partitionNames(parent: string): Promise<string[]> {
    const result = await owner.query<{ relname: string }>(
      `select c.relname from pg_inherits i
       join pg_class c on c.oid = i.inhrelid
       where i.inhparent = $1::regclass order by c.relname`,
      [parent],
    );
    return result.rows.map((r) => r.relname);
  }

  it("is not executable by the runtime role", async () => {
    await expect(
      database.sql.query("select ensure_monitor_partitions(3)"),
    ).rejects.toThrow(/permission denied/);
  });

  it("creates previous, current and 3 following months with forced RLS", async () => {
    await ensureMonitorPartitions(ownerDatabase, { monthsAhead: 3 });
    for (const parent of parents) {
      const names = await partitionNames(parent);
      for (const offset of [-1, 0, 1, 2, 3]) {
        expect(names).toContain(monthName(parent, offset));
      }
      const flags = await owner.query<{ relforcerowsecurity: boolean }>(
        `select c.relforcerowsecurity from pg_inherits i
         join pg_class c on c.oid = i.inhrelid where i.inhparent = $1::regclass`,
        [parent],
      );
      expect(flags.rows.length).toBeGreaterThan(0);
      expect(flags.rows.every((r) => r.relforcerowsecurity)).toBe(true);
      const grant = await owner.query<{ ok: boolean }>(
        "select has_table_privilege('nightwatch', $1::regclass, 'select') as ok",
        [`public.${monthName(parent, 0)}`],
      );
      expect(grant.rows[0]?.ok).toBe(false);
    }
  });

  it("drops partitions older than 31 days and keeps current and future ones", async () => {
    const old = "monitor_check_results_p200101";
    const far = "monitor_check_results_p203501";
    await owner.query(
      `create table if not exists ${old} partition of monitor_check_results
         for values from ('2001-01-01Z') to ('2001-02-01Z')`,
    );
    await owner.query(
      `create table if not exists ${far} partition of monitor_check_results
         for values from ('2035-01-01Z') to ('2035-02-01Z')`,
    );
    try {
      await ensureMonitorPartitions(ownerDatabase, { monthsAhead: 3 });
      const names = await partitionNames("monitor_check_results");
      expect(names).not.toContain(old);
      expect(names).toContain(far);
      expect(names).toContain(monthName("monitor_check_results", 0));
    } finally {
      await owner.query(`drop table if exists ${old}`);
      await owner.query(`drop table if exists ${far}`);
    }
  });

  it("rejects months ahead outside 0..12", async () => {
    await expect(
      ownerDatabase.sql.query("select ensure_monitor_partitions(13)"),
    ).rejects.toThrow(/between 0 and 12/);
  });
});

describe("purge_expired_monitor_data", () => {
  // Fixture partitions are created here, never assumed from
  // ensure_monitor_partitions, so the tests do not depend on the calendar
  // (a 31-day-old row can fall two months back on the 1st of a month).
  const createdPartitions: string[] = [];
  const fixtureMonitors: string[] = [];

  async function ensureFixturePartitions(atSql: string): Promise<void> {
    const month = await owner.query<{
      yyyymm: string;
      lo: string;
      hi: string;
    }>(
      `select to_char(m, 'YYYYMM') as yyyymm,
              to_char(m, 'YYYY-MM-DD"T"00:00:00"Z"') as lo,
              to_char(m + interval '1 month', 'YYYY-MM-DD"T"00:00:00"Z"') as hi
       from (select date_trunc('month', (${atSql}) at time zone 'UTC') as m) t`,
    );
    const { yyyymm, lo, hi } = must(month.rows[0]);
    for (const parent of ["monitor_check_results", "monitor_check_hourly"]) {
      const name = `${parent}_p${yyyymm}`;
      const exists = await owner.query<{ found: boolean }>(
        "select to_regclass($1) is not null as found",
        [`public.${name}`],
      );
      if (exists.rows[0]?.found) continue;
      await owner.query(
        `create table if not exists ${name} partition of ${parent}
           for values from ('${lo}') to ('${hi}')`,
      );
      createdPartitions.push(name);
    }
  }

  afterAll(async () => {
    if (!ownerConnected) return;
    await owner.query("delete from monitors where id = any($1::uuid[])", [
      fixtureMonitors,
    ]);
    for (const name of createdPartitions) {
      const left = await owner.query<{ n: string }>(
        `select count(*) as n from ${name}`,
      );
      if (Number(left.rows[0]?.n) === 0) {
        await owner.query(`drop table if exists ${name}`);
      }
    }
  });

  async function seedAged(monitorId: string, tenantId: string, days: number) {
    const at = `now() - interval '${String(days)} days'`;
    await ensureFixturePartitions(at);
    await owner.query(
      `insert into monitor_check_results
         (monitor_id, tenant_id, scheduled_for, checked_at, outcome,
          url_masked, check_config_version, interval_seconds)
       values ($1, $2, ${at}, ${at}, 'pass', 'u', 1, 60)`,
      [monitorId, tenantId],
    );
    await owner.query(
      `insert into monitor_check_hourly (monitor_id, tenant_id, hour_start)
       values ($1, $2, date_trunc('hour', ${at}))`,
      [monitorId, tenantId],
    );
    await owner.query(
      `insert into monitor_events (monitor_id, tenant_id, kind, occurred_at)
       values ($1, $2, 'config_changed', ${at})`,
      [monitorId, tenantId],
    );
  }

  async function seedIncident(
    monitorId: string,
    tenantId: string,
    startedDaysAgo: number,
    endedDaysAgo: number | null,
  ): Promise<string> {
    const id = randomUUID();
    await owner.query(
      `insert into monitor_incidents
         (id, monitor_id, tenant_id, started_at, ended_at, end_reason, start_reason)
       values ($1, $2, $3, now() - make_interval(days => $4),
               case when $5::int is null then null
                    else now() - make_interval(days => $5::int) end,
               case when $5::int is null then null else 'recovered' end,
               'timeout')`,
      [id, monitorId, tenantId, startedDaysAgo, endedDaysAgo],
    );
    return id;
  }

  async function freshMonitor(): Promise<string> {
    const id = await withTenantContextRaw(database, tenantA, (client) =>
      insertMonitor(client, tenantA),
    );
    fixtureMonitors.push(id);
    return id;
  }

  it("deletes expired rows on both sides of a month boundary", async () => {
    const monitorId = await freshMonitor();
    const before = "'2001-02-28T23:59:59Z'::timestamptz";
    const after = "'2001-03-01T00:00:00Z'::timestamptz";
    await ensureFixturePartitions(before);
    await ensureFixturePartitions(after);
    for (const at of [before, after]) {
      await owner.query(
        `insert into monitor_check_results
           (monitor_id, tenant_id, scheduled_for, checked_at, outcome,
            url_masked, check_config_version, interval_seconds)
         values ($1, $2, ${at}, ${at}, 'pass', 'u', 1, 60)`,
        [monitorId, tenantA],
      );
    }
    let deleted = 1;
    for (let i = 0; i < 20 && deleted > 0; i += 1) {
      deleted = await purgeExpiredMonitorData(database, { limit: 1000 });
    }
    expect(await ownerCount("monitor_check_results", [monitorId])).toBe(0);
  });

  it("keeps 29-day rows and open incidents, deletes 31-day rows and old closed incidents", async () => {
    const monitorId = await freshMonitor();
    await seedAged(monitorId, tenantA, 29);
    await seedAged(monitorId, tenantA, 31);
    const closed29 = await seedIncident(monitorId, tenantA, 45, 29);
    // A monitor holds one open incident, so the 31-day-old closed one and
    // the 40-day-old open one live on separate monitors.
    const otherMonitor = await freshMonitor();
    const closed31 = await seedIncident(otherMonitor, tenantA, 50, 31);
    const open40 = await seedIncident(monitorId, tenantA, 40, null);

    let deleted = 1;
    for (let i = 0; i < 20 && deleted > 0; i += 1) {
      deleted = await purgeExpiredMonitorData(database, { limit: 1000 });
    }

    const remaining = async (table: string, column: string) => {
      const r = await owner.query<{ age_days: number }>(
        `select extract(day from now() - ${column})::int as age_days
         from ${table} where monitor_id = $1 order by 1`,
        [monitorId],
      );
      return r.rows.map((row) => row.age_days);
    };
    expect(await remaining("monitor_check_results", "scheduled_for")).toEqual([
      29,
    ]);
    expect(await remaining("monitor_check_hourly", "hour_start")).toHaveLength(
      1,
    );
    expect(await remaining("monitor_events", "occurred_at")).toEqual([29]);

    const incidents = await owner.query<{ id: string }>(
      "select id from monitor_incidents where id = any($1::uuid[])",
      [[closed29, closed31, open40]],
    );
    expect(incidents.rows.map((r) => r.id).sort()).toEqual(
      [closed29, open40].sort(),
    );
  });

  async function drainExpired(): Promise<void> {
    let deleted = 1;
    for (let i = 0; i < 50 && deleted > 0; i += 1) {
      deleted = await purgeExpiredMonitorData(database, { limit: 1000 });
    }
  }

  /** Rows at explicit 2002 timestamps, oldest first, so they sort ahead of
   * any other expired row once the table has been drained. */
  async function seedExpired(
    monitorId: string,
    counts: { results: number; hourly: number; events: number },
  ): Promise<void> {
    const at = (day: number) =>
      `2002-01-${String(day).padStart(2, "0")}T00:00:00Z`;
    await ensureFixturePartitions(`'${at(1)}'::timestamptz`);
    for (let day = 1; day <= counts.results; day += 1) {
      await owner.query(
        `insert into monitor_check_results
           (monitor_id, tenant_id, scheduled_for, checked_at, outcome,
            url_masked, check_config_version, interval_seconds)
         values ($1, $2, $3, $3, 'pass', 'u', 1, 60)`,
        [monitorId, tenantA, at(day)],
      );
    }
    for (let day = 1; day <= counts.hourly; day += 1) {
      await owner.query(
        `insert into monitor_check_hourly (monitor_id, tenant_id, hour_start)
         values ($1, $2, $3)`,
        [monitorId, tenantA, at(day)],
      );
    }
    for (let day = 1; day <= counts.events; day += 1) {
      await owner.query(
        `insert into monitor_events (monitor_id, tenant_id, kind, occurred_at)
         values ($1, $2, 'config_changed', $3)`,
        [monitorId, tenantA, at(day)],
      );
    }
  }

  async function remainingRows(monitorId: string) {
    const r = await owner.query<{
      results: string;
      hourly: string;
      events: string;
    }>(
      `select (select count(*) from monitor_check_results where monitor_id = $1) as results,
              (select count(*) from monitor_check_hourly where monitor_id = $1) as hourly,
              (select count(*) from monitor_events where monitor_id = $1) as events`,
      [monitorId],
    );
    const row = must(r.rows[0]);
    return {
      results: Number(row.results),
      hourly: Number(row.hourly),
      events: Number(row.events),
    };
  }

  it("deletes exactly p_limit rows when more are expired", async () => {
    const monitorId = await freshMonitor();
    await drainExpired();
    await seedExpired(monitorId, { results: 5, hourly: 5, events: 5 });
    const deleted = await purgeExpiredMonitorData(database, { limit: 2 });
    expect(deleted).toBe(2);
    expect(await remainingRows(monitorId)).toEqual({
      results: 3,
      hourly: 5,
      events: 5,
    });
    await expect(
      database.sql.query("select purge_expired_monitor_data(0)"),
    ).rejects.toThrow(/between 1 and 1000/);
  });

  it("spends the remaining limit on later tables when results run out", async () => {
    const monitorId = await freshMonitor();
    await drainExpired();
    await seedExpired(monitorId, { results: 1, hourly: 3, events: 3 });
    const deleted = await purgeExpiredMonitorData(database, { limit: 5 });
    expect(deleted).toBe(5);
    expect(await remainingRows(monitorId)).toEqual({
      results: 0,
      hourly: 0,
      events: 2,
    });
  });
});

describe("purge of monitor_last_responses", () => {
  async function seedLastResponse(daysAgo: number): Promise<string> {
    const monitorId = await withTenantContextRaw(database, tenantA, (client) =>
      insertMonitor(client, tenantA),
    );
    // A paused monitor gets no new result, so its row is never overwritten.
    await owner.query(
      `insert into monitor_last_responses
         (monitor_id, tenant_id, scheduled_for, checked_at, config_version,
          outcome, url_masked)
       values ($1, $2, now() - make_interval(days => $3),
               now() - make_interval(days => $3), 1, 'pass', 'u')`,
      [monitorId, tenantA, daysAgo],
    );
    return monitorId;
  }

  it("deletes a last response older than 30 days by scheduled_for and keeps a 29-day one", async () => {
    const old = await seedLastResponse(31);
    const recent = await seedLastResponse(29);
    let deleted = 1;
    for (let i = 0; i < 50 && deleted > 0; i += 1) {
      deleted = await purgeExpiredMonitorData(database, { limit: 1000 });
    }
    expect(await ownerCount("monitor_last_responses", [old])).toBe(0);
    expect(await ownerCount("monitor_last_responses", [recent])).toBe(1);
    await owner.query("delete from monitors where id = any($1::uuid[])", [
      [old, recent],
    ]);
  });
});

describe("monitor deletion", () => {
  it("cascades secrets, schedule and child data", async () => {
    const { monitorId } = await seedTenant(tenantA);
    const tables = MONITOR_TABLES.filter((t) => t !== "monitors");
    for (const table of tables) {
      expect(await ownerCount(table, [monitorId])).toBe(1);
    }
    await withTenantContextRaw(database, tenantA, (client) =>
      client.query("delete from monitors where id = $1", [monitorId]),
    );
    expect(await ownerCount("monitors", [monitorId])).toBe(0);
    for (const table of tables) {
      expect(await ownerCount(table, [monitorId])).toBe(0);
    }
  });
});

describe("monitor catalog invariants", () => {
  it("enables and forces RLS on every monitor table and partition", async () => {
    const result = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       where c.relnamespace = 'public'::regnamespace
         and c.relkind in ('r', 'p')
         and (c.relname like 'monitor\\_%' or c.relname = 'monitors')`,
    );
    const names = result.rows.map((r) => r.relname);
    for (const table of MONITOR_TABLES) expect(names).toContain(table);
    expect(
      result.rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity),
    ).toEqual([]);
  });

  it("gives each table a restrictive guard and permissive tenant policy with WITH CHECK", async () => {
    const result = await owner.query<{
      tablename: string;
      policyname: string;
      permissive: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, policyname, permissive, roles::text[] as roles, qual, with_check
       from pg_policies where tablename = any($1::text[])`,
      [[...MONITOR_TABLES]],
    );
    for (const table of MONITOR_TABLES) {
      const mine = result.rows.filter(
        (r) => r.tablename === table && r.roles.includes("nightwatch"),
      );
      const restrictive = mine.filter((r) => r.permissive === "RESTRICTIVE");
      const permissive = mine.filter((r) => r.permissive === "PERMISSIVE");
      expect(restrictive).toHaveLength(1);
      expect(permissive).toHaveLength(1);
      expect(permissive[0]?.qual).toContain("app.tenant_id");
      expect(permissive[0]?.with_check).toContain("app.tenant_id");
    }
  });

  it("defines the three functions with fixed search_path, dedicated owners and restricted EXECUTE", async () => {
    const result = await owner.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      owner: string;
      owner_super: boolean;
      owner_login: boolean;
      owner_bypassrls: boolean;
      runtime_exec: boolean;
      public_exec: boolean;
    }>(
      `select p.proname, p.prosecdef, p.proconfig, r.rolname as owner,
              r.rolsuper as owner_super, r.rolcanlogin as owner_login,
              r.rolbypassrls as owner_bypassrls,
              has_function_privilege('nightwatch', p.oid, 'execute') as runtime_exec,
              has_function_privilege('public', p.oid, 'execute') as public_exec
       from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('claim_due_monitor_checks', 'purge_expired_monitor_data',
                           'ensure_monitor_partitions')`,
    );
    const byName = new Map(result.rows.map((r) => [r.proname, r]));
    expect(byName.size).toBe(3);
    for (const row of byName.values()) {
      expect(row.prosecdef).toBe(true);
      expect(row.proconfig).toEqual(["search_path=pg_catalog, public"]);
      expect(row.public_exec).toBe(false);
    }
    const claim = must(byName.get("claim_due_monitor_checks"));
    const purge = must(byName.get("purge_expired_monitor_data"));
    const ensure = must(byName.get("ensure_monitor_partitions"));
    expect(claim.owner).toBe("nightwatch_monitor_schedule_owner");
    expect(purge.owner).toBe("nightwatch_monitor_retention_owner");
    expect(ensure.owner).toBe("nightwatch_owner");
    for (const row of [claim, purge]) {
      expect(row.owner_login).toBe(false);
      expect(row.owner_super).toBe(false);
      expect(row.owner_bypassrls).toBe(false);
      expect(row.runtime_exec).toBe(true);
    }
    expect(ensure.runtime_exec).toBe(false);
  });
});

describe("monitor_events feed columns", () => {
  const userIds: string[] = [];
  const monitorIds: string[] = [];

  async function freshMonitor(): Promise<string> {
    const id = await withTenantContextRaw(database, tenantA, (client) =>
      insertMonitor(client, tenantA),
    );
    monitorIds.push(id);
    return id;
  }

  async function createUser(): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await owner.query(
      `insert into "user" (id, name, email) values ($1, 'Feed Actor', $2)`,
      [id, `feed-${id}@example.test`],
    );
    return id;
  }

  function insertEvent(
    monitorId: string,
    columns: Record<string, string | number | null>,
  ): Promise<unknown> {
    const names = ["monitor_id", "tenant_id", ...Object.keys(columns)];
    const values = [monitorId, tenantA, ...Object.values(columns)];
    return withTenantContextRaw(database, tenantA, (client) =>
      client.query(
        `insert into monitor_events (${names.join(", ")})
         values (${names.map((_, i) => `$${String(i + 1)}`).join(", ")})`,
        values,
      ),
    );
  }

  afterAll(async () => {
    if (!ownerConnected) return;
    await owner.query("delete from monitors where id = any($1::uuid[])", [
      monitorIds,
    ]);
    await owner.query('delete from "user" where id = any($1::text[])', [
      userIds,
    ]);
  });

  it("accepts check_failed with its fields and defaults actor_kind to unrecorded", async () => {
    const monitorId = await freshMonitor();
    await insertEvent(monitorId, {
      kind: "check_failed",
      failure_reason: "http_status",
      tls_reason: null,
      http_status: 503,
      response_time_ms: 120,
    });
    const r = await owner.query<{ actor_kind: string; actor_user_id: null }>(
      "select actor_kind, actor_user_id from monitor_events where monitor_id = $1",
      [monitorId],
    );
    expect(r.rows).toEqual([{ actor_kind: "unrecorded", actor_user_id: null }]);
  });

  it("rejects an unknown kind and an unknown actor_kind", async () => {
    const monitorId = await freshMonitor();
    await expect(insertEvent(monitorId, { kind: "deleted" })).rejects.toThrow(
      /monitor_events_kind_check/,
    );
    await expect(
      insertEvent(monitorId, { kind: "paused", actor_kind: "system" }),
    ).rejects.toThrow(/monitor_events_actor_kind_check/);
  });

  it("rejects an actor on check_failed and an actor_user_id without actor_kind user", async () => {
    const monitorId = await freshMonitor();
    const userId = await createUser();
    await expect(
      insertEvent(monitorId, { kind: "check_failed", actor_kind: "user" }),
    ).rejects.toThrow(/monitor_events_actor_scope_check/);
    await expect(
      insertEvent(monitorId, { kind: "paused", actor_user_id: userId }),
    ).rejects.toThrow(/monitor_events_actor_user_check/);
  });

  it("rejects changes outside config_changed and check_failed fields outside check_failed", async () => {
    const monitorId = await freshMonitor();
    await expect(
      insertEvent(monitorId, { kind: "paused", changes: "[]" }),
    ).rejects.toThrow(/monitor_events_changes_scope_check/);
    for (const column of [
      "failure_reason",
      "tls_reason",
      "http_status",
      "response_time_ms",
    ]) {
      await expect(
        insertEvent(monitorId, {
          kind: "config_changed",
          [column]:
            column.endsWith("status") || column.endsWith("ms") ? 1 : "x",
        }),
      ).rejects.toThrow(/monitor_events_check_failed_scope_check/);
    }
    await insertEvent(monitorId, {
      kind: "config_changed",
      actor_kind: "user",
      changes: '[{"field":"name","kind":"value","before":"a","after":"b"}]',
    });
  });

  it("keeps actor_kind user and nulls actor_user_id when the account is deleted, under FORCE RLS with select and insert grants only", async () => {
    const monitorId = await freshMonitor();
    const userId = await createUser();
    await insertEvent(monitorId, { kind: "paused" });
    await insertEvent(monitorId, {
      kind: "resumed",
      actor_kind: "user",
      actor_user_id: userId,
    });
    const actors = async () =>
      (
        await owner.query<{
          kind: string;
          actor_kind: string;
          actor_user_id: string | null;
        }>(
          `select kind, actor_kind, actor_user_id from monitor_events
           where monitor_id = $1 order by kind`,
          [monitorId],
        )
      ).rows;
    expect(await actors()).toEqual([
      { kind: "paused", actor_kind: "unrecorded", actor_user_id: null },
      { kind: "resumed", actor_kind: "user", actor_user_id: userId },
    ]);

    await owner.query('delete from "user" where id = $1', [userId]);
    expect(await actors()).toEqual([
      { kind: "paused", actor_kind: "unrecorded", actor_user_id: null },
      { kind: "resumed", actor_kind: "user", actor_user_id: null },
    ]);
    const privileges = await owner.query<{ priv: string; ok: boolean }>(
      `select p as priv, has_table_privilege('nightwatch', 'monitor_events', p) as ok
       from unnest(array['UPDATE', 'DELETE']) as p`,
    );
    expect(privileges.rows.filter((row) => row.ok)).toEqual([]);
  });

  it("hides another tenant's actor_user_id columns from tenant B", async () => {
    const monitorId = await freshMonitor();
    const userId = await createUser();
    await insertEvent(monitorId, {
      kind: "paused",
      actor_kind: "user",
      actor_user_id: userId,
    });
    const asB = await withTenantContextRaw(database, tenantB, (client) =>
      client.query("select 1 from monitor_events where monitor_id = $1", [
        monitorId,
      ]),
    );
    expect(asB.rows).toEqual([]);
  });
});

describe("monitor_last_responses CHECK constraints", () => {
  async function insertLast(
    columns: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const monitorId = await withTenantContextRaw(database, tenantA, (client) =>
      insertMonitor(client, tenantA),
    );
    try {
      const all: Record<string, string | number | boolean | null> = {
        monitor_id: monitorId,
        tenant_id: tenantA,
        config_version: 1,
        outcome: "pass",
        url_masked: "u",
        ...columns,
      };
      const names = Object.keys(all);
      await withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          `insert into monitor_last_responses
             (scheduled_for, checked_at, ${names.join(", ")})
           values (now(), now(), ${names.map((_, i) => `$${String(i + 1)}`).join(", ")})`,
          Object.values(all),
        ),
      );
    } finally {
      await owner.query("delete from monitors where id = $1", [monitorId]);
    }
  }

  it("accepts a request_values row that keeps only version and status", async () => {
    await insertLast({
      detail_omitted: "request_values",
      http_version: "HTTP/1.1",
      http_status: 200,
      body_kind: "omitted",
      body_omitted_reason: "request_values",
    });
  });

  it("accepts a full row without detail_omitted", async () => {
    await insertLast({
      http_version: "HTTP/1.0",
      http_status: 200,
      reason_phrase: "OK",
      headers:
        '[{"name":"content-type","value":"text/plain","redacted":false}]',
      body_kind: "text",
      body_text: "ok",
      body_truncated: false,
      body_bytes_read: 2,
    });
  });

  it("rejects request_values with a reason phrase, headers or body text", async () => {
    const base = { detail_omitted: "request_values" };
    await expect(insertLast({ ...base, reason_phrase: "OK" })).rejects.toThrow(
      /monitor_last_responses_request_values_check/,
    );
    await expect(
      insertLast({
        ...base,
        headers: '[{"name":"a","value":"b","redacted":false}]',
      }),
    ).rejects.toThrow(/monitor_last_responses_request_values_check/);
    await expect(
      insertLast({ ...base, body_kind: "text", body_text: "leak" }),
    ).rejects.toThrow(/monitor_last_responses_request_values_check/);
  });

  it("rejects an unknown detail_omitted, http_version, body_kind and body_omitted_reason", async () => {
    await expect(insertLast({ detail_omitted: "other" })).rejects.toThrow(
      /monitor_last_responses_detail_omitted_check/,
    );
    await expect(insertLast({ http_version: "HTTP/2" })).rejects.toThrow(
      /monitor_last_responses_http_version_check/,
    );
    await expect(insertLast({ body_kind: "binary" })).rejects.toThrow(
      /monitor_last_responses_body_kind_check/,
    );
    await expect(insertLast({ body_omitted_reason: "other" })).rejects.toThrow(
      /monitor_last_responses_body_omitted_reason_check/,
    );
  });

  it("keeps one row per monitor", async () => {
    await expect(
      withTenantContextRaw(database, tenantA, (client) =>
        client.query(
          `insert into monitor_last_responses
             (monitor_id, tenant_id, scheduled_for, checked_at, config_version,
              outcome, url_masked)
           values ($1, $2, now(), now(), 1, 'pass', 'u')`,
          [seededA.monitorId, tenantA],
        ),
      ),
    ).rejects.toThrow(/monitor_last_responses_pkey/);
  });
});

describe("monitor_incidents end values", () => {
  it("stores end_http_status and end_response_time_ms and leaves existing incidents null", async () => {
    const r = await owner.query<{
      end_http_status: number | null;
      end_response_time_ms: number | null;
    }>(
      `select end_http_status, end_response_time_ms from monitor_incidents
       where monitor_id = $1`,
      [seededA.monitorId],
    );
    expect(r.rows).toEqual([
      { end_http_status: null, end_response_time_ms: null },
    ]);
    await withTenantContextRaw(database, tenantA, (client) =>
      client.query(
        `update monitor_incidents set end_http_status = 200, end_response_time_ms = 80
         where monitor_id = $1`,
        [seededA.monitorId],
      ),
    );
    const after = await owner.query<{ end_http_status: number }>(
      "select end_http_status from monitor_incidents where monitor_id = $1",
      [seededA.monitorId],
    );
    expect(after.rows[0]?.end_http_status).toBe(200);
  });
});
