import {
  createDatabase,
  withTenantContextRaw,
} from "../../packages/db/src/index.ts";

export type OwnedMonitor = Readonly<{
  tenantId: string;
  projectId: string;
  monitorId: string;
}>;

type CheckReceipt = {
  scheduled_for: Date;
  checked_at: Date;
  outcome: "pass" | "fail" | "check_error";
  failure_reason: string | null;
};

export type MonitorCheckpoint = {
  receipts: CheckReceipt[];
  incidentOpen: boolean;
};

export function isolatedMonitorDatabaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  const url = new URL(env.DATABASE_URL ?? "");
  const redis = new URL(env.REDIS_URL ?? "");
  const database = url.pathname.slice(1);
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const local =
    /^nw_e2e_[0-9a-f]{32}$/.test(database) && env.REDIS_KEY_PREFIX === database;
  const ci =
    env.CI === "true" &&
    env.GITHUB_ACTIONS === "true" &&
    database === "nightwatch" &&
    url.port === "5432" &&
    env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION === "ci" &&
    env.E2E_REQUIRE_CREDENTIALS === "1";
  if (
    env.NODE_ENV === "production" ||
    url.username !== "nightwatch" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["redis:", "rediss:"].includes(redis.protocol) ||
    !loopback(url.hostname) ||
    !loopback(redis.hostname) ||
    (!local && !ci)
  ) {
    if (
      env.NODE_ENV !== "production" &&
      (env.CI || env.E2E_EXTERNAL_SERVICES === "1")
    ) {
      return null;
    }
    throw new Error(
      "Monitor eligibility changes require an isolated E2E database and runtime role",
    );
  }
  return url.toString();
}

/**
 * Advances transition/response fixtures only. Interval-weighted charts, uptime,
 * durations, and natural cadence require separate, unaccelerated monitors.
 */
export async function driveMonitorChecks(
  owned: OwnedMonitor,
  reached: (checkpoint: MonitorCheckpoint) => boolean,
  maxChecks: number,
): Promise<MonitorCheckpoint | null> {
  if (!Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 4) {
    throw new Error("Expected 1..4 extra real checks");
  }
  const url = isolatedMonitorDatabaseUrl(process.env);
  if (url === null) return null;
  const database = createDatabase(url);
  const scope = [owned.tenantId, owned.projectId, owned.monitorId];
  const deadline = Date.now() + 120_000;
  let pending: string | undefined;
  let advanced = 0;
  try {
    const role = await database.sql.query<{ safe: boolean }>(
      `select not r.rolsuper and not r.rolbypassrls
              and not pg_has_role(c.relowner, 'MEMBER') as safe
         from pg_roles r cross join pg_class c
        where r.rolname = current_user and c.oid = 'monitor_schedule'::regclass`,
    );
    if (role.rows[0]?.safe !== true)
      throw new Error("Refusing privileged monitor runtime access");
    while (Date.now() < deadline) {
      const checkpoint = await withTenantContextRaw(
        database,
        owned.tenantId,
        async (client) => {
          await client.query("set local lock_timeout = '2s'");
          const monitor = await client.query(
            `select id from monitors where tenant_id = $1 and project_id = $2
              and id = $3 and status = 'active' for update`,
            scope,
          );
          if (monitor.rowCount !== 1)
            throw new Error("Owned monitor must be active");
          const schedule = await client.query<{
            claim_token: string | null;
            next_check_at: Date;
          }>(
            `select s.claim_token, s.next_check_at from monitor_schedule s
             join monitors m on m.id = s.monitor_id and m.tenant_id = s.tenant_id
            where m.tenant_id = $1 and m.project_id = $2 and m.id = $3
              and s.check_config_version = m.check_config_version and s.next_check_at is not null
            for update of s`,
            scope,
          );
          const s = schedule.rows[0];
          if (!s) {
            throw new Error(
              "Owned schedule must match the active monitor configuration",
            );
          }
          if (s.claim_token !== null) return null;
          const results = await client.query<CheckReceipt>(
            `select r.scheduled_for, r.checked_at, r.outcome, r.failure_reason
             from monitor_check_results r join monitors m on m.id = r.monitor_id and m.tenant_id = r.tenant_id
            where m.tenant_id = $1 and m.project_id = $2 and m.id = $3 order by r.scheduled_for`,
            scope,
          );
          const received = results.rows.some(
            (r) => r.scheduled_for.toISOString() === pending,
          );
          if (pending !== undefined && !received) {
            if (s.next_check_at.toISOString() === pending) return null;
            throw new Error(
              `Consumed slot has no persisted receipt: ${pending}`,
            );
          }
          pending = undefined;
          const incident = await client.query(
            `select i.id from monitor_incidents i join monitors m on m.id = i.monitor_id and m.tenant_id = i.tenant_id
            where m.tenant_id = $1 and m.project_id = $2 and m.id = $3 and i.ended_at is null`,
            scope,
          );
          const observed = {
            receipts: results.rows,
            incidentOpen: incident.rowCount === 1,
          };
          if (reached(observed)) return observed;
          if (advanced === maxChecks)
            throw new Error(
              `Checkpoint not reached after ${maxChecks} extra checks: ${JSON.stringify(observed)}`,
            );
          const due = await client.query<{ next_check_at: Date }>(
            `update monitor_schedule s
              set next_check_at = date_trunc('milliseconds', greatest(clock_timestamp(),
                    coalesce((select max(r.scheduled_for) + interval '1 millisecond'
                      from monitor_check_results r where r.tenant_id = $1 and r.monitor_id = $3), clock_timestamp())))
             from monitors m
            where m.tenant_id = $1 and m.project_id = $2 and m.id = $3
              and s.tenant_id = m.tenant_id and s.monitor_id = m.id
              and m.status = 'active' and s.claim_token is null
              and s.check_config_version = m.check_config_version
          returning s.next_check_at`,
            scope,
          );
          if (due.rowCount !== 1)
            throw new Error("Expected exactly one idle owned schedule");
          pending = due.rows[0]!.next_check_at.toISOString();
          advanced++;
          return null;
        },
      );
      if (checkpoint) return checkpoint;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `Monitor checkpoint timed out: ${JSON.stringify({ owned, pending, advanced })}`,
    );
  } finally {
    await database.close();
  }
}
