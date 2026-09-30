import {
  MONITOR_LIMIT_PER_ORGANIZATION,
  MONITOR_RESPONSE_POINTS_MAX,
  type CheckResultView,
  type MonitorChecksResponse,
  type MonitorDetailResponse,
  type MonitorHistoryQuery,
  type MonitorIncidentsResponse,
  type MonitorHealthName,
  type MonitorListQuery,
  type MonitorResponseTimesResponse,
  type MonitorListResponse,
  type MonitorRecentEvent,
  type SslLevelName,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { computeHealth, computeSsl } from "./health";
import { assertMemberPermissionBeforeTenantContext } from "./permissions";
import { MONITOR_COLUMNS, toRecord, type MonitorRow } from "./record";
import {
  computeGaps,
  computeUptime,
  derivePauses,
  HOUR_MS,
  windowStart,
  type Interval,
  type UptimeAggregate,
  type UptimeWindow,
} from "./uptime";

export type ReadIdentity = { organizationId: string; actorUserId: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function monitorNotFound(): never {
  throw new AppError(404, "MONITOR_NOT_FOUND", "ไม่พบมอนิเตอร์นี้");
}

// A malformed id answers like a missing or foreign one (AC-48).
export function parseMonitorId(raw: string): string {
  if (!UUID_PATTERN.test(raw)) monitorNotFound();
  return raw;
}

/**
 * Membership and read permission are checked before tenant context, then all
 * queries of a request run in one transaction, so `now()` is one instant for
 * freshness, SSL level, uptime windows and `dataAsOf`.
 */
export async function readInTenant<T>(
  database: Database,
  identity: ReadIdentity,
  work: (client: PoolClient, now: Date) => Promise<T>,
): Promise<T> {
  await assertMemberPermissionBeforeTenantContext(database, {
    organizationId: identity.organizationId,
    userId: identity.actorUserId,
    permission: "read",
  });
  return withTenantContextRaw(
    database,
    identity.organizationId,
    async (client) => {
      const clock = await client.query<{ now: Date }>("select now() as now");
      const now = clock.rows[0]?.now;
      if (!now) throw new Error("database returned no time");
      return work(client, now);
    },
  );
}

// ---- Monitor state ---------------------------------------------------------

type StateRow = {
  id: string;
  name: string;
  url: string;
  status: "active" | "paused";
  createdAt: Date;
  intervalSeconds: number;
  checkConfigVersion: number;
  consecutiveFailures: number;
  lastPassedConfigVersion: number | null;
  sslHost: string | null;
  sslIssuer: string | null;
  sslNotAfter: Date | null;
  sslState: string | null;
  sslReason: string | null;
  matches: boolean;
  incidentStartedAt: Date | null;
  incidentReason: string | null;
  latestScheduledFor: Date | null;
  latestCheckedAt: Date | null;
  latestOutcome: "pass" | "fail" | "check_error" | null;
  latestHttpStatus: number | null;
  latestResponseTimeMs: number | null;
  latestFailureReason: CheckResultView["failureReason"];
  latestTlsReason: CheckResultView["tlsReason"];
  latestAssertions: CheckResultView["assertions"] | null;
  latestUrlMasked: string | null;
  latestConfigVersion: number | null;
  latestEvaluatedFromPrefix: boolean | null;
  /** `now() - checked_at` measured by the database. */
  latestAgeSeconds: number | null;
  /**
   * The newest `resumed` event is later than the slot of the newest result.
   * Both are database times (Resume sets next_check_at to the event time), so a
   * Worker clock that runs behind cannot make the first result after a Resume
   * look older than it.
   */
  latestPredatesResume: boolean;
};

// The host of a stored URL, for `q`. URLs are validated on save (no userinfo).
const HOST_PATTERN = String.raw`(?i)^https?://(\[[^\]]*\]|[^/:?#]+)`;

const STATE_QUERY = `
  select m.id, m.name, m.url, m.status, m.created_at as "createdAt",
    m.interval_seconds as "intervalSeconds",
    m.check_config_version as "checkConfigVersion",
    m.consecutive_failures as "consecutiveFailures",
    m.last_passed_config_version as "lastPassedConfigVersion",
    m.ssl_host as "sslHost", m.ssl_issuer as "sslIssuer",
    m.ssl_not_after as "sslNotAfter", m.ssl_state as "sslState",
    m.ssl_reason as "sslReason",
    ($3::text is null
      or m.name ilike $3
      or substring(m.url from '${HOST_PATTERN}') ilike $3) as matches,
    i.started_at as "incidentStartedAt", i.start_reason as "incidentReason",
    r."scheduledFor" as "latestScheduledFor", r."checkedAt" as "latestCheckedAt",
    r.outcome as "latestOutcome", r."httpStatus" as "latestHttpStatus",
    r."responseTimeMs" as "latestResponseTimeMs",
    r."failureReason" as "latestFailureReason",
    r."tlsReason" as "latestTlsReason", r.assertions as "latestAssertions",
    r."urlMasked" as "latestUrlMasked", r."configVersion" as "latestConfigVersion",
    r."evaluatedFromPrefix" as "latestEvaluatedFromPrefix",
    extract(epoch from (now() - r."checkedAt"))::float8 as "latestAgeSeconds",
    coalesce(resumed.at > r."scheduledFor", false) as "latestPredatesResume"
  from monitors m
  left join lateral (
    select scheduled_for as "scheduledFor", checked_at as "checkedAt", outcome,
      http_status as "httpStatus", response_time_ms as "responseTimeMs",
      failure_reason as "failureReason", tls_reason as "tlsReason", assertions,
      url_masked as "urlMasked", check_config_version as "configVersion",
      evaluated_from_prefix as "evaluatedFromPrefix"
    from monitor_check_results
    where monitor_id = m.id and tenant_id = m.tenant_id
    order by scheduled_for desc
    limit 1
  ) r on true
  left join lateral (
    select max(occurred_at) as at from monitor_events
    where monitor_id = m.id and tenant_id = m.tenant_id and kind = 'resumed'
  ) resumed on true
  left join lateral (
    select started_at, start_reason from monitor_incidents
    where monitor_id = m.id and tenant_id = m.tenant_id and ended_at is null
  ) i on true
  where m.tenant_id = $1 and ($2::uuid is null or m.id = $2)
  order by lower(m.name), m.id`;

// Bound as a parameter; `%`, `_` and the escape character match literally.
function likePattern(q: string | undefined): string | null {
  if (q === undefined || q === "") return null;
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function loadStates(
  client: PoolClient,
  organizationId: string,
  options: { monitorId?: string; q?: string } = {},
): Promise<StateRow[]> {
  const result = await client.query<StateRow>(STATE_QUERY, [
    organizationId,
    options.monitorId ?? null,
    likePattern(options.q),
  ]);
  return result.rows;
}

export function healthOf(row: StateRow) {
  const health = computeHealth({
    status: row.status,
    checkConfigVersion: row.checkConfigVersion,
    intervalSeconds: row.intervalSeconds,
    consecutiveFailures: row.consecutiveFailures,
    lastPassedConfigVersion: row.lastPassedConfigVersion,
    hasOpenIncident: row.incidentStartedAt !== null,
    latest:
      row.latestOutcome === null ||
      row.latestConfigVersion === null ||
      row.latestAgeSeconds === null
        ? null
        : {
            outcome: row.latestOutcome,
            configVersion: row.latestConfigVersion,
            ageSeconds: row.latestAgeSeconds,
            predatesResume: row.latestPredatesResume,
          },
  });
  return {
    ...health,
    consecutiveFailures: row.consecutiveFailures,
    lastCheckAt: row.latestCheckedAt?.toISOString() ?? null,
    openIncident:
      row.incidentStartedAt === null
        ? null
        : {
            startedAt: row.incidentStartedAt.toISOString(),
            reason: row.incidentReason ?? "",
          },
  };
}

export function sslOf(row: StateRow, now: Date) {
  return computeSsl(
    {
      host: row.sslHost,
      issuer: row.sslIssuer,
      notAfter: row.sslNotAfter,
      state: row.sslState,
      reason: row.sslReason,
    },
    now,
  );
}

// ---- Uptime ----------------------------------------------------------------

export type UptimeWindows = {
  h24: UptimeWindow;
  d7: UptimeWindow;
  d30: UptimeWindow;
};

type AggregateRow = {
  monitorId: string;
  checks: number;
  passed: number;
  coveredSeconds: number;
};

type HourlyRow = {
  monitorId: string;
  checks7: number;
  passed7: number;
  covered7: number;
  checks30: number;
  passed30: number;
  covered30: number;
};

const EMPTY_AGGREGATE: UptimeAggregate = {
  checks: 0,
  passed: 0,
  coveredSeconds: 0,
};

function aggregateByMonitor(
  rows: AggregateRow[],
): Map<string, UptimeAggregate> {
  return new Map(rows.map((row) => [row.monitorId, row]));
}

/**
 * 24 h from raw results (primary-key range on `(monitor_id, scheduled_for)`),
 * 7 d and 30 d from hourly rollups; raw results older than 24 h are never read.
 * check_error rows are excluded here and never enter a rollup.
 */
export async function loadUptime(
  client: PoolClient,
  organizationId: string,
  monitors: { id: string; status: "active" | "paused"; createdAt: Date }[],
  now: Date,
): Promise<Map<string, UptimeWindows>> {
  const ids = monitors.map((monitor) => monitor.id);
  const start24 = windowStart("24h", now);
  const start7 = windowStart("7d", now);
  const start30 = windowStart("30d", now);

  // One primary-key range per monitor: `unnest` drives a lateral probe on
  // (monitor_id, scheduled_for) and (monitor_id, hour_start), so the plan never
  // scans a partition for a whole Organization.
  const raw = await client.query<AggregateRow>(
    `select t.id as "monitorId", a.checks, a.passed, a."coveredSeconds"
     from unnest($2::uuid[]) as t(id)
     cross join lateral (
       select (count(*) filter (where outcome <> 'check_error'))::int as checks,
         (count(*) filter (where outcome = 'pass'))::int as passed,
         coalesce(sum(interval_seconds) filter (where outcome <> 'check_error'), 0)::int
           as "coveredSeconds"
       from monitor_check_results r
       where r.monitor_id = t.id and r.tenant_id = $1 and r.scheduled_for >= $3
     ) a`,
    [organizationId, ids, start24],
  );
  const hourly = await client.query<HourlyRow>(
    `select t.id as "monitorId",
       a.checks7, a.passed7, a.covered7, a.checks30, a.passed30, a.covered30
     from unnest($2::uuid[]) as t(id)
     cross join lateral (
       select
         coalesce(sum(h.checks) filter (where h.hour_start >= $3), 0)::int as checks7,
         coalesce(sum(h.passed) filter (where h.hour_start >= $3), 0)::int as passed7,
         coalesce(sum(h.covered_seconds) filter (where h.hour_start >= $3), 0)::int
           as covered7,
         coalesce(sum(h.checks), 0)::int as checks30,
         coalesce(sum(h.passed), 0)::int as passed30,
         coalesce(sum(h.covered_seconds), 0)::int as covered30
       from monitor_check_hourly h
       where h.monitor_id = t.id and h.tenant_id = $1 and h.hour_start >= $4
     ) a`,
    [organizationId, ids, start7, start30],
  );

  const h24 = aggregateByMonitor(raw.rows);
  const d7 = aggregateByMonitor(
    hourly.rows.map((row) => ({
      monitorId: row.monitorId,
      checks: row.checks7,
      passed: row.passed7,
      coveredSeconds: row.covered7,
    })),
  );
  const d30 = aggregateByMonitor(
    hourly.rows.map((row) => ({
      monitorId: row.monitorId,
      checks: row.checks30,
      passed: row.passed30,
      coveredSeconds: row.covered30,
    })),
  );
  const events = await loadPauseEvents(client, organizationId, ids, start30);

  return new Map(
    monitors.map((monitor) => {
      const monitorEvents = events.get(monitor.id) ?? [];
      const window = (
        aggregates: Map<string, UptimeAggregate>,
        start: Date,
      ): UptimeWindow =>
        computeUptime(aggregates.get(monitor.id) ?? EMPTY_AGGREGATE, {
          start,
          createdAt: monitor.createdAt,
          now,
          pauses: derivePauses(monitorEvents, monitor.status, start, now),
        });
      return [
        monitor.id,
        {
          h24: window(h24, start24),
          d7: window(d7, start7),
          d30: window(d30, start30),
        },
      ];
    }),
  );
}

export type PauseEvent = { kind: "paused" | "resumed"; at: Date };

export async function loadPauseEvents(
  client: PoolClient,
  organizationId: string,
  monitorIds: string[],
  since: Date,
): Promise<Map<string, PauseEvent[]>> {
  const result = await client.query<{
    monitorId: string;
    kind: "paused" | "resumed";
    at: Date;
  }>(
    `select monitor_id as "monitorId", kind, occurred_at as at
     from monitor_events
     where tenant_id = $1 and monitor_id = any($2::uuid[])
       and kind in ('paused', 'resumed') and occurred_at >= $3
     order by occurred_at, id`,
    [organizationId, monitorIds, since],
  );
  const byMonitor = new Map<string, PauseEvent[]>();
  for (const row of result.rows) {
    const list = byMonitor.get(row.monitorId) ?? [];
    list.push({ kind: row.kind, at: row.at });
    byMonitor.set(row.monitorId, list);
  }
  return byMonitor;
}

export function toIsoInterval(interval: Interval) {
  return {
    from: interval.from.toISOString(),
    to: interval.to.toISOString(),
  };
}

// ---- List ------------------------------------------------------------------

const HEALTH_ORDER: Record<MonitorHealthName, number> = {
  down: 0,
  unknown: 1,
  up: 2,
  paused: 3,
};

export async function listMonitors(
  database: Database,
  identity: ReadIdentity,
  query: MonitorListQuery,
): Promise<MonitorListResponse> {
  return readInTenant(database, identity, async (client, now) => {
    // At most 50 rows per Organization, so health is computed for all of them
    // and the summary never depends on the filters. The database orders by
    // lower(name), id; the health group sort is stable on top of that.
    const rows = await loadStates(client, identity.organizationId, {
      q: query.q,
    });
    const scored = rows.map((row) => ({ row, state: healthOf(row) }));

    const summary = { up: 0, down: 0, unknown: 0, paused: 0 };
    for (const { state } of scored) summary[state.health] += 1;

    const filtered = scored
      .filter(
        ({ row, state }) =>
          row.matches &&
          (query.health === undefined || state.health === query.health),
      )
      .sort(
        (left, right) =>
          HEALTH_ORDER[left.state.health] - HEALTH_ORDER[right.state.health],
      );
    const pageRows = filtered.slice(query.offset, query.offset + query.limit);
    const uptime = await loadUptime(
      client,
      identity.organizationId,
      pageRows.map(({ row }) => row),
      now,
    );

    return {
      summary: {
        ...summary,
        total: scored.length,
        limit: MONITOR_LIMIT_PER_ORGANIZATION,
      },
      monitors: pageRows.map(({ row, state }) => {
        const windows = uptime.get(row.id);
        if (!windows) throw new Error("uptime missing for a listed monitor");
        const ssl = sslOf(row, now);
        return {
          id: row.id,
          name: row.name,
          url: row.url,
          status: row.status,
          ...state,
          lastResponseTimeMs: row.latestResponseTimeMs,
          ssl: {
            level: ssl.level,
            daysRemaining: ssl.daysRemaining,
            host: row.sslHost,
          },
          uptime: { h24: windows.h24, d30: windows.d30 },
        };
      }),
      page: {
        limit: query.limit,
        offset: query.offset,
        total: filtered.length,
      },
      dataAsOf: now.toISOString(),
    };
  });
}

// ---- Recent events ---------------------------------------------------------

const RECENT_DAYS = 30;

type IncidentEventRow = {
  kind: "incident_opened" | "incident_closed";
  monitorId: string;
  monitorName: string;
  at: Date;
  reason: string;
  durationSeconds: number | null;
};

export async function listRecentEvents(
  database: Database,
  identity: ReadIdentity,
  limit: number,
): Promise<{ events: MonitorRecentEvent[] }> {
  return readInTenant(database, identity, async (client, now) => {
    const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
    // Both branches are driven from the tenant's monitors, so each probe is a
    // single-monitor range on monitor_incidents_history_idx and no other
    // Organization's incidents are scanned.
    const incidents = await client.query<IncidentEventRow>(
      `(select 'incident_opened' as kind, m.id as "monitorId",
          m.name as "monitorName", i.started_at as at,
          i.start_reason as reason, null::int as "durationSeconds"
        from monitors m
        cross join lateral (
          select started_at, start_reason from monitor_incidents
          where monitor_id = m.id and tenant_id = m.tenant_id and started_at >= $2
          order by started_at desc limit $3
        ) i
        where m.tenant_id = $1
        order by i.started_at desc limit $3)
       union all
       (select 'incident_closed', m.id, m.name, i.ended_at, i.end_reason,
          floor(extract(epoch from (i.ended_at - i.started_at)))::int
        from monitors m
        cross join lateral (
          select started_at, ended_at, end_reason from monitor_incidents
          where monitor_id = m.id and tenant_id = m.tenant_id and ended_at >= $2
          order by ended_at desc limit $3
        ) i
        where m.tenant_id = $1
        order by i.ended_at desc limit $3)`,
      [identity.organizationId, since, limit],
    );

    // The SSL level now is not an event in the table: a monitor whose level
    // computed from the database time is caution, danger or expired is listed,
    // stamped with the time it entered that level (clamped to the window and
    // to the monitor's creation), so it ages out like an incident.
    const monitors = await client.query<{
      id: string;
      name: string;
      createdAt: Date;
      lastCheckAt: Date | null;
      updatedAt: Date;
      sslHost: string | null;
      sslIssuer: string | null;
      sslNotAfter: Date | null;
      sslState: string | null;
      sslReason: string | null;
    }>(
      `select id, name, created_at as "createdAt", last_check_at as "lastCheckAt",
         updated_at as "updatedAt", ssl_host as "sslHost",
         ssl_issuer as "sslIssuer", ssl_not_after as "sslNotAfter",
         ssl_state as "sslState", ssl_reason as "sslReason"
       from monitors where tenant_id = $1`,
      [identity.organizationId],
    );
    const sslEvents: MonitorRecentEvent[] = [];
    for (const monitor of monitors.rows) {
      const ssl = computeSsl(
        {
          host: monitor.sslHost,
          issuer: monitor.sslIssuer,
          notAfter: monitor.sslNotAfter,
          state: monitor.sslState,
          reason: monitor.sslReason,
        },
        now,
      );
      if (!isSslProblem(ssl.level)) continue;
      sslEvents.push({
        kind: "ssl_level",
        monitorId: monitor.id,
        monitorName: monitor.name,
        at: sslEnteredAt(ssl.level, monitor, since).toISOString(),
        reason: null,
        sslLevel: ssl.level,
        ...(ssl.daysRemaining === null
          ? {}
          : { daysRemaining: ssl.daysRemaining }),
      });
    }

    const events: MonitorRecentEvent[] = [
      ...incidents.rows.map((row) => ({
        kind: row.kind,
        monitorId: row.monitorId,
        monitorName: row.monitorName,
        at: row.at.toISOString(),
        reason: row.reason,
        ...(row.durationSeconds === null
          ? {}
          : { durationSeconds: row.durationSeconds }),
      })),
      ...sslEvents,
    ];
    events.sort(compareEvents);
    return { events: events.slice(0, limit) };
  });
}

const DAY_MS = 86_400_000;
const SSL_LEVEL_LEAD_DAYS = { caution: 30, danger: 7, expired: 0 } as const;

function sslEnteredAt(
  level: SslLevelName,
  monitor: {
    createdAt: Date;
    lastCheckAt: Date | null;
    updatedAt: Date;
    sslNotAfter: Date | null;
  },
  windowStart: Date,
): Date {
  // Without an expiry date (expired handshake) the last observation is all we
  // have. It is clamped like the dated path, so an event never predates the
  // 30 days of stored data; such a monitor is listed at the window start.
  const floor = Math.max(windowStart.getTime(), monitor.createdAt.getTime());
  if (monitor.sslNotAfter === null) {
    const observed = (monitor.lastCheckAt ?? monitor.updatedAt).getTime();
    return new Date(Math.max(observed, floor));
  }
  const lead = SSL_LEVEL_LEAD_DAYS[level as keyof typeof SSL_LEVEL_LEAD_DAYS];
  const entered = monitor.sslNotAfter.getTime() - lead * DAY_MS;
  return new Date(Math.max(entered, floor));
}

function isSslProblem(level: SslLevelName): boolean {
  return level === "caution" || level === "danger" || level === "expired";
}

// at desc, then a fixed order so equal timestamps never reshuffle.
function compareEvents(
  left: MonitorRecentEvent,
  right: MonitorRecentEvent,
): number {
  if (left.at !== right.at) return left.at < right.at ? 1 : -1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return left.monitorId < right.monitorId ? -1 : 1;
}

// ---- Detail ----------------------------------------------------------------

function latestResultOf(row: StateRow): CheckResultView | null {
  if (
    row.latestScheduledFor === null ||
    row.latestCheckedAt === null ||
    row.latestOutcome === null ||
    row.latestConfigVersion === null
  ) {
    return null;
  }
  return {
    scheduledFor: row.latestScheduledFor.toISOString(),
    checkedAt: row.latestCheckedAt.toISOString(),
    outcome: row.latestOutcome,
    httpStatus: row.latestHttpStatus,
    responseTimeMs: row.latestResponseTimeMs,
    failureReason: row.latestFailureReason,
    tlsReason: row.latestTlsReason,
    assertions: row.latestAssertions ?? [],
    url: row.latestUrlMasked ?? "",
    configVersion: row.latestConfigVersion,
    evaluatedFromPrefix: row.latestEvaluatedFromPrefix ?? false,
  };
}

export async function getMonitor(
  database: Database,
  identity: ReadIdentity,
  rawMonitorId: string,
): Promise<MonitorDetailResponse> {
  return readInTenant(database, identity, async (client, now) => {
    const monitorId = parseMonitorId(rawMonitorId);
    const found = await client.query<MonitorRow>(
      `select ${MONITOR_COLUMNS} from monitors
       where id = $1 and tenant_id = $2`,
      [monitorId, identity.organizationId],
    );
    const monitor = found.rows[0];
    if (!monitor) monitorNotFound();
    const slots = await client.query<{ slot: string }>(
      "select slot from monitor_secrets where monitor_id = $1 and tenant_id = $2 order by slot",
      [monitorId, identity.organizationId],
    );
    const [state] = await loadStates(client, identity.organizationId, {
      monitorId,
    });
    if (!state) monitorNotFound();
    const windows = (
      await loadUptime(client, identity.organizationId, [state], now)
    ).get(monitorId);
    if (!windows) throw new Error("uptime missing for the monitor");
    const ssl = sslOf(state, now);

    return {
      monitor: {
        ...toRecord(
          monitor,
          slots.rows.map((row) => row.slot),
        ),
        ...healthOf(state),
        lastResult: latestResultOf(state),
        ssl: {
          state: ssl.level,
          host: state.sslHost,
          issuer: state.sslIssuer,
          notAfter: state.sslNotAfter?.toISOString() ?? null,
          daysRemaining: ssl.daysRemaining,
          reason: state.sslReason,
        },
        uptime: windows,
        dataAsOf: now.toISOString(),
      },
    };
  });
}

// ---- Check history and incidents -------------------------------------------

async function assertMonitorInTenant(
  client: PoolClient,
  organizationId: string,
  rawMonitorId: string,
): Promise<string> {
  const monitorId = parseMonitorId(rawMonitorId);
  const found = await client.query(
    "select 1 from monitors where id = $1 and tenant_id = $2",
    [monitorId, organizationId],
  );
  if (found.rows.length === 0) monitorNotFound();
  return monitorId;
}

type CheckRow = Omit<CheckResultView, "scheduledFor" | "checkedAt"> & {
  scheduledFor: Date;
  checkedAt: Date;
};

export async function listChecks(
  database: Database,
  identity: ReadIdentity,
  rawMonitorId: string,
  query: MonitorHistoryQuery,
): Promise<MonitorChecksResponse> {
  return readInTenant(database, identity, async (client) => {
    const monitorId = await assertMonitorInTenant(
      client,
      identity.organizationId,
      rawMonitorId,
    );
    // One row more than the page: it is the check just before the page, which
    // bounds the URL changes that belong to this page.
    const rows = await client.query<CheckRow>(
      `select scheduled_for as "scheduledFor", checked_at as "checkedAt", outcome,
         http_status as "httpStatus", response_time_ms as "responseTimeMs",
         failure_reason as "failureReason", tls_reason as "tlsReason", assertions,
         url_masked as url, check_config_version as "configVersion",
         evaluated_from_prefix as "evaluatedFromPrefix"
       from monitor_check_results
       where monitor_id = $1 and tenant_id = $2
       order by scheduled_for desc
       offset $3 limit $4`,
      [monitorId, identity.organizationId, query.offset, query.limit + 1],
    );
    const total = await client.query<{ total: number }>(
      `select count(*)::int as total from monitor_check_results
       where monitor_id = $1 and tenant_id = $2`,
      [monitorId, identity.organizationId],
    );
    const page = rows.rows.slice(0, query.limit);
    const before = rows.rows[query.limit]?.scheduledFor ?? null;
    const newest = page[0]?.scheduledFor ?? null;

    // A URL change belongs to the page that holds the first check after it.
    // The first page also takes changes newer than every check.
    const changes =
      query.offset > 0 && newest === null
        ? []
        : (
            await client.query<{ at: Date; url: string }>(
              `select occurred_at as at, url_masked as url from monitor_events
               where monitor_id = $1 and tenant_id = $2
                 and kind = 'config_changed' and url_masked is not null
                 and ($3::timestamptz is null or occurred_at > $3)
                 and ($4::timestamptz is null or occurred_at <= $4)
               order by occurred_at desc, id`,
              [
                monitorId,
                identity.organizationId,
                before,
                query.offset === 0 ? null : newest,
              ],
            )
          ).rows;

    return {
      checks: page.map((row) => ({
        ...row,
        scheduledFor: row.scheduledFor.toISOString(),
        checkedAt: row.checkedAt.toISOString(),
      })),
      page: {
        limit: query.limit,
        offset: query.offset,
        total: total.rows[0]?.total ?? 0,
      },
      urlChanges: changes.map((change) => ({
        at: change.at.toISOString(),
        url: change.url,
      })),
    };
  });
}

export async function listIncidents(
  database: Database,
  identity: ReadIdentity,
  rawMonitorId: string,
  query: MonitorHistoryQuery,
): Promise<MonitorIncidentsResponse> {
  return readInTenant(database, identity, async (client) => {
    const monitorId = await assertMonitorInTenant(
      client,
      identity.organizationId,
      rawMonitorId,
    );
    const rows = await client.query<{
      id: string;
      startedAt: Date;
      endedAt: Date | null;
      durationSeconds: number;
      startReason: string;
      startHttpStatus: number | null;
      endReason: "recovered" | "paused_by_user" | null;
    }>(
      `select id, started_at as "startedAt", ended_at as "endedAt",
         floor(extract(epoch from (coalesce(ended_at, now()) - started_at)))::int
           as "durationSeconds",
         start_reason as "startReason", start_http_status as "startHttpStatus",
         end_reason as "endReason"
       from monitor_incidents
       where monitor_id = $1 and tenant_id = $2
       order by started_at desc, id
       offset $3 limit $4`,
      [monitorId, identity.organizationId, query.offset, query.limit],
    );
    const total = await client.query<{ total: number }>(
      `select count(*)::int as total from monitor_incidents
       where monitor_id = $1 and tenant_id = $2`,
      [monitorId, identity.organizationId],
    );
    return {
      incidents: rows.rows.map((row) => ({
        ...row,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
      })),
      page: {
        limit: query.limit,
        offset: query.offset,
        total: total.rows[0]?.total ?? 0,
      },
    };
  });
}

// ---- Response times --------------------------------------------------------

export async function getResponseTimes(
  database: Database,
  identity: ReadIdentity,
  rawMonitorId: string,
  range: "24h" | "7d" | "30d",
): Promise<MonitorResponseTimesResponse> {
  return readInTenant(database, identity, async (client, now) => {
    const monitorId = parseMonitorId(rawMonitorId);
    const found = await client.query<{ status: "active" | "paused" }>(
      "select status from monitors where id = $1 and tenant_id = $2",
      [monitorId, identity.organizationId],
    );
    const monitor = found.rows[0];
    if (!monitor) monitorNotFound();

    const start = windowStart(range, now);
    const pauseEvents = await loadPauseEvents(
      client,
      identity.organizationId,
      [monitorId],
      start,
    );
    const pauses = derivePauses(
      pauseEvents.get(monitorId) ?? [],
      monitor.status,
      start,
      now,
    );
    const changes = await client.query<{ at: Date; url: string | null }>(
      `select occurred_at as at, url_masked as url from monitor_events
       where monitor_id = $1 and tenant_id = $2 and kind = 'config_changed'
         and occurred_at >= $3
       order by occurred_at, id`,
      [monitorId, identity.organizationId, start],
    );
    const common = {
      unit: "ms" as const,
      pauses: pauses.map(toIsoInterval),
      configChanges: changes.rows.map((change) => ({
        at: change.at.toISOString(),
        urlChanged: change.url !== null,
        ...(change.url === null ? {} : { url: change.url }),
      })),
    };

    if (range === "24h") {
      // Same boundary as the 24 h uptime window; newest MONITOR_RESPONSE_POINTS_MAX rows.
      const rows = await client.query<{
        checkedAt: Date;
        responseTimeMs: number | null;
        outcome: "pass" | "fail" | "check_error";
        intervalSeconds: number;
      }>(
        `select checked_at as "checkedAt", response_time_ms as "responseTimeMs",
           outcome, interval_seconds as "intervalSeconds"
         from monitor_check_results
         where monitor_id = $1 and tenant_id = $2 and scheduled_for >= $3
         order by scheduled_for desc
         limit $4`,
        [
          monitorId,
          identity.organizationId,
          start,
          MONITOR_RESPONSE_POINTS_MAX,
        ],
      );
      const ordered = rows.rows.reverse();
      const gaps = computeGaps(
        ordered
          .filter((row) => row.outcome !== "check_error")
          .map((row) => ({
            at: row.checkedAt,
            intervalSeconds: row.intervalSeconds,
          })),
        pauses,
      );
      return {
        range,
        points: ordered.map((row) => ({
          at: row.checkedAt.toISOString(),
          responseTimeMs: row.responseTimeMs,
          outcome: row.outcome,
        })),
        gaps: gaps.map(toIsoInterval),
        ...common,
      };
    }

    const rows = await client.query<{
      hourStart: Date;
      checks: number;
      responseChecks: number;
      responseMsSum: string;
      responseMsMax: number | null;
    }>(
      `select hour_start as "hourStart", checks, response_checks as "responseChecks",
         response_ms_sum::text as "responseMsSum",
         response_ms_max as "responseMsMax"
       from monitor_check_hourly
       where monitor_id = $1 and tenant_id = $2 and hour_start >= $3
         and hour_start < $4`,
      [monitorId, identity.organizationId, start, now],
    );
    const byHour = new Map(
      rows.rows.map((row) => [row.hourStart.getTime(), row]),
    );
    const buckets = [];
    for (let hour = start.getTime(); hour < now.getTime(); hour += HOUR_MS) {
      const row = byHour.get(hour);
      const measured = row !== undefined && row.responseChecks > 0;
      buckets.push({
        hourStart: new Date(hour).toISOString(),
        avgMs: measured
          ? Math.round((Number(row.responseMsSum) / row.responseChecks) * 100) /
            100
          : null,
        maxMs: measured ? row.responseMsMax : null,
        checks: row?.checks ?? 0,
        responseChecks: row?.responseChecks ?? 0,
      });
    }
    return { range, buckets, ...common };
  });
}
