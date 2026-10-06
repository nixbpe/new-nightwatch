import type { MonitorTestContext } from "./test-support";

// Fixtures are written straight into the tables (no Worker) with the owner
// connection. Every time is "seconds before the database now()", so a fixture
// is independent of the test process clock.

export type SeedMonitor = {
  name?: string;
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  status?: "active" | "paused";
  intervalSeconds?: number;
  createdAgoSeconds?: number;
  checkConfigVersion?: number;
  consecutiveFailures?: number;
  lastPassedConfigVersion?: number | null;
  alertFailureThreshold?: number;
  lastCheckAgoSeconds?: number | null;
  sslHost?: string | null;
  sslIssuer?: string | null;
  sslNotAfterInSeconds?: number | null;
  sslState?: string | null;
  sslReason?: string | null;
};

export async function seedMonitor(
  ctx: MonitorTestContext,
  organizationId: string,
  options: SeedMonitor = {},
): Promise<string> {
  const interval = options.intervalSeconds ?? 300;
  const result = await ctx.owner.sql.query<{ id: string }>(
    `insert into monitors
       (tenant_id, client_request_id, name, url, status, interval_seconds,
        timeout_seconds, check_config_version, consecutive_failures,
        last_passed_config_version, last_check_at, ssl_host, ssl_not_after,
        ssl_state, ssl_reason, created_at, updated_at, alert_failure_threshold,
        method, ssl_issuer)
     values ($1, gen_random_uuid(), $2, $3, $4, $5, 10, $6, $7, $8,
       case when $9::float8 is null then null
            else now() - make_interval(secs => $9::float8) end,
       $10,
       case when $11::float8 is null then null
            else now() + make_interval(secs => $11::float8) end,
       $12, $13,
       now() - make_interval(secs => $14::float8),
       now() - make_interval(secs => $14::float8),
       $15, $16, $17)
     returning id`,
    [
      organizationId,
      options.name ?? "Fixture monitor",
      options.url ?? "https://fixture.example/health",
      options.status ?? "active",
      interval,
      options.checkConfigVersion ?? 1,
      options.consecutiveFailures ?? 0,
      options.lastPassedConfigVersion === undefined
        ? 1
        : options.lastPassedConfigVersion,
      options.lastCheckAgoSeconds ?? null,
      options.sslHost ?? null,
      options.sslNotAfterInSeconds ?? null,
      options.sslState ?? null,
      options.sslReason ?? null,
      options.createdAgoSeconds ?? 90 * 86400,
      options.alertFailureThreshold ?? 2,
      options.method ?? "GET",
      options.sslIssuer ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("fixture monitor was not inserted");
  return row.id;
}

export type SeedResults = {
  outcome?: "pass" | "fail" | "check_error";
  intervalSeconds?: number;
  configVersion?: number;
  responseTimeMs?: number | null;
  httpStatus?: number | null;
  failureReason?: string | null;
  tlsReason?: string | null;
  urlMasked?: string;
  assertions?: unknown[];
};

/** One row per age in `agesSeconds`; scheduled_for and checked_at are the same instant. */
export async function seedResults(
  ctx: MonitorTestContext,
  organizationId: string,
  monitorId: string,
  agesSeconds: number[],
  options: SeedResults = {},
): Promise<void> {
  const outcome = options.outcome ?? "pass";
  await ctx.owner.sql.query(
    `insert into monitor_check_results
       (monitor_id, tenant_id, scheduled_for, checked_at, outcome, http_status,
        response_time_ms, failure_reason, tls_reason, assertions, url_masked,
        check_config_version, interval_seconds)
     select $1, $2, now() - make_interval(secs => a.ago),
       now() - make_interval(secs => a.ago), $3, $4, $5, $6, $7, $8::jsonb,
       $9, $10, $11
     from unnest($12::float8[]) as a(ago)`,
    [
      monitorId,
      organizationId,
      outcome,
      options.httpStatus === undefined
        ? outcome === "check_error"
          ? null
          : outcome === "pass"
            ? 200
            : 500
        : options.httpStatus,
      options.responseTimeMs === undefined ? 120 : options.responseTimeMs,
      options.failureReason ??
        (outcome === "fail"
          ? "http_status"
          : outcome === "check_error"
            ? "executor_error"
            : null),
      options.tlsReason ?? null,
      JSON.stringify(options.assertions ?? []),
      options.urlMasked ?? "https://fixture.example/health",
      options.configVersion ?? 1,
      options.intervalSeconds ?? 300,
      agesSeconds,
    ],
  );
}

/** Rebuilds the hourly rollup from the raw rows the way the Worker does: check_error is left out. */
export async function rollupFromResults(
  ctx: MonitorTestContext,
  monitorId: string,
): Promise<void> {
  await ctx.owner.sql.query(
    `insert into monitor_check_hourly
       (monitor_id, tenant_id, hour_start, checks, passed, covered_seconds,
        response_checks, response_ms_sum, response_ms_max)
     select monitor_id, tenant_id, date_trunc('hour', scheduled_for),
       count(*), count(*) filter (where outcome = 'pass'),
       sum(interval_seconds), count(response_time_ms),
       sum(coalesce(response_time_ms, 0)), max(response_time_ms)
     from monitor_check_results
     where monitor_id = $1 and outcome <> 'check_error'
     group by monitor_id, tenant_id, date_trunc('hour', scheduled_for)`,
    [monitorId],
  );
}

/** A hand-written rollup row for the hour starting `hoursAgo` full hours before the current hour. */
export async function seedHourly(
  ctx: MonitorTestContext,
  organizationId: string,
  monitorId: string,
  hoursAgo: number[],
  row: {
    checks: number;
    passed: number;
    coveredSeconds: number;
    /** Results that had a response time; defaults to `checks` when a max is given, else 0. */
    responseChecks?: number;
    responseMsSum?: number;
    responseMsMax?: number | null;
  },
): Promise<void> {
  await ctx.owner.sql.query(
    `insert into monitor_check_hourly
       (monitor_id, tenant_id, hour_start, checks, passed, covered_seconds,
        response_checks, response_ms_sum, response_ms_max)
     select $1, $2, date_trunc('hour', now()) - make_interval(hours => h.n),
       $3, $4, $5, $9, $6, $7
     from unnest($8::int[]) as h(n)`,
    [
      monitorId,
      organizationId,
      row.checks,
      row.passed,
      row.coveredSeconds,
      row.responseMsSum ?? 0,
      row.responseMsMax ?? null,
      hoursAgo,
      row.responseChecks ?? (row.responseMsMax == null ? 0 : row.checks),
    ],
  );
}

export async function seedEvent(
  ctx: MonitorTestContext,
  organizationId: string,
  monitorId: string,
  kind: "paused" | "resumed" | "config_changed",
  agoSeconds: number,
  urlMasked: string | null = null,
): Promise<void> {
  await ctx.owner.sql.query(
    `insert into monitor_events (monitor_id, tenant_id, kind, occurred_at, url_masked)
     values ($1, $2, $3, now() - make_interval(secs => $4::float8), $5)`,
    [monitorId, organizationId, kind, agoSeconds, urlMasked],
  );
}

export async function seedIncident(
  ctx: MonitorTestContext,
  organizationId: string,
  monitorId: string,
  incident: {
    startedAgoSeconds: number;
    endedAgoSeconds?: number;
    reason?: string;
    httpStatus?: number | null;
    endReason?: "recovered" | "paused_by_user";
  },
): Promise<string> {
  const closed = incident.endedAgoSeconds !== undefined;
  const result = await ctx.owner.sql.query<{ id: string }>(
    `insert into monitor_incidents
       (monitor_id, tenant_id, started_at, ended_at, start_reason,
        start_http_status, end_reason)
     values ($1, $2, now() - make_interval(secs => $3::float8),
       case when $4::float8 is null then null
            else now() - make_interval(secs => $4::float8) end,
       $5, $6, $7)
     returning id`,
    [
      monitorId,
      organizationId,
      incident.startedAgoSeconds,
      incident.endedAgoSeconds ?? null,
      incident.reason ?? "http_status",
      incident.httpStatus === undefined ? 500 : incident.httpStatus,
      closed ? (incident.endReason ?? "recovered") : null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("fixture incident was not inserted");
  return row.id;
}

export function ageSeries(
  count: number,
  stepSeconds: number,
  firstSeconds = 0,
) {
  return Array.from(
    { length: count },
    (_, index) => firstSeconds + index * stepSeconds,
  );
}

/** Explicit raw samples for response-times boundary and population fixtures. */
export async function seedResponseSamples(
  ctx: MonitorTestContext,
  organizationId: string,
  monitorId: string,
  samples: {
    scheduledFor: string;
    checkedAt?: string;
    outcome: "pass" | "fail" | "check_error";
    responseTimeMs: number | null;
  }[],
): Promise<void> {
  await ctx.owner.sql.query(
    `insert into monitor_check_results
      (monitor_id, tenant_id, scheduled_for, checked_at, outcome, response_time_ms,
       failure_reason, assertions, url_masked, check_config_version, interval_seconds)
     select $1, $2, s."scheduledFor"::timestamptz,
       coalesce(s."checkedAt", s."scheduledFor")::timestamptz, s.outcome, s."responseTimeMs",
       case s.outcome when 'fail' then 'http_status' when 'check_error' then 'executor_error' end,
       '[]'::jsonb, 'https://fixture.example/health', 1, 60
     from jsonb_to_recordset($3::jsonb) as s("scheduledFor" text, "checkedAt" text, outcome text, "responseTimeMs" integer)`,
    [monitorId, organizationId, JSON.stringify(samples)],
  );
}
