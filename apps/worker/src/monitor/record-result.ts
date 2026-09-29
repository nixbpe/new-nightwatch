import { withTenantContextRaw, type Database } from "@nightwatch/db";
import { sslLevel, type CheckResult } from "@nightwatch/shared";

/** The transaction handle of `withTenantContextRaw`. */
export type TenantClient = Parameters<
  Parameters<typeof withTenantContextRaw>[2]
>[0];

export type RecordInput = {
  tenantId: string;
  monitorId: string;
  claimToken: string;
  checkConfigVersion: number;
  scheduledFor: Date;
  /** Interval that applied when the check ran. */
  intervalSeconds: number;
  result: CheckResult;
};

export type RecordOutcome = "recorded" | "discarded" | "duplicate";

type EventContext = {
  tenantId: string;
  monitorId: string;
  monitorName: string;
  occurredAt: Date;
};

export type MonitorEvent = EventContext &
  (
    | {
        type: "incident_opened";
        incidentId: string;
        reason: string;
        httpStatus: number | null;
      }
    | {
        type: "incident_closed";
        incidentId: string;
        endReason: "recovered" | "paused_by_user";
        /** Whether a MONITOR_DOWN notification went out for this incident. */
        downNotified: boolean;
      }
    | {
        type: "ssl_level_entered";
        level: "caution" | "danger" | "expired";
        host: string;
        notAfter: Date;
      }
  );

export type MonitorEventHook = (
  tx: TenantClient,
  event: MonitorEvent,
) => Promise<void>;

/**
 * Called inside transaction B, after the row change it describes, only for a
 * result that was really inserted. Task 09 writes notification intents here.
 */
export const onMonitorEvent: MonitorEventHook = async () => {};

export type RecordOptions = { onEvent?: MonitorEventHook };

type LockedMonitor = {
  name: string;
  consecutive_failures: number;
  last_passed_config_version: number | null;
  ssl_host: string | null;
  ssl_issuer: string | null;
  ssl_not_after: Date | null;
  ssl_state: string | null;
};

type OpenIncident = { id: string; down_notified: boolean };

/** Thrown to roll back an attempt that has to run again with the advisory lock. */
class NeedsMembershipLock extends Error {}

/**
 * Transaction B of a check. A result is kept only while the claim that
 * produced it is still the monitor's current one: Pause, Delete and an Edit
 * that affects checks clear or replace it, and the late result is dropped.
 *
 * Lock order (Concurrency): organization FOR SHARE, advisory
 * notification-membership (only when an event may follow), monitors FOR
 * UPDATE, monitor_schedule, monitor_incidents. Most results emit no event, so
 * the first attempt runs without the advisory lock; when the locked state
 * shows an event is possible the attempt is rolled back and repeated in the
 * proper order instead of taking the lock after monitors.
 */
export async function recordCheckResult(
  database: Database,
  input: RecordInput,
  options: RecordOptions = {},
): Promise<RecordOutcome> {
  const onEvent = options.onEvent ?? onMonitorEvent;
  try {
    return await attempt(database, input, onEvent, false);
  } catch (error) {
    if (!(error instanceof NeedsMembershipLock)) throw error;
    return attempt(database, input, onEvent, true);
  }
}

function attempt(
  database: Database,
  input: RecordInput,
  onEvent: MonitorEventHook,
  membershipLocked: boolean,
): Promise<RecordOutcome> {
  const { result } = input;
  return withTenantContextRaw(database, input.tenantId, async (client) => {
    await client.query("select id from organization where id = $1 for share", [
      input.tenantId,
    ]);
    if (membershipLocked) {
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        `notification-membership:${input.tenantId}`,
      ]);
    }
    const monitorRows = await client.query<LockedMonitor>(
      `select name, consecutive_failures, last_passed_config_version,
              ssl_host, ssl_issuer, ssl_not_after, ssl_state
       from monitors where id = $1 and tenant_id = $2 for update`,
      [input.monitorId, input.tenantId],
    );
    const monitor = monitorRows.rows[0];
    if (!monitor) return "discarded";

    const claim = await client.query(
      `update monitor_schedule set claim_token = null
       where monitor_id = $1 and claim_token = $2 and check_config_version = $3`,
      [input.monitorId, input.claimToken, input.checkConfigVersion],
    );
    if (claim.rowCount === 0) return "discarded";

    const incidentRows = await client.query<OpenIncident>(
      `select id, down_notified from monitor_incidents
       where monitor_id = $1 and ended_at is null`,
      [input.monitorId],
    );
    const open = incidentRows.rows[0] ?? null;
    const next = nextState(monitor, open !== null, input);
    const ssl = nextSsl(monitor, result);
    if (!membershipLocked && (next.event !== null || ssl.event !== null)) {
      throw new NeedsMembershipLock();
    }

    if (!(await insertResult(client, input))) return "duplicate";
    if (result.outcome !== "check_error") await upsertRollup(client, input);
    await client.query(
      `update monitors set consecutive_failures = $2, last_check_at = $3,
         last_outcome = $4, last_passed_config_version = $5
       where id = $1`,
      [
        input.monitorId,
        next.consecutiveFailures,
        result.checkedAt,
        result.outcome,
        next.lastPassedConfigVersion,
      ],
    );

    const context = {
      tenantId: input.tenantId,
      monitorId: input.monitorId,
      monitorName: monitor.name,
      occurredAt: result.checkedAt,
    };
    if (next.event === "open") {
      const created = await client.query<{ id: string }>(
        `insert into monitor_incidents
           (monitor_id, tenant_id, started_at, start_reason, start_http_status)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          input.monitorId,
          input.tenantId,
          result.checkedAt,
          result.failureReason ?? "http_status",
          result.httpStatus,
        ],
      );
      await onEvent(client, {
        ...context,
        type: "incident_opened",
        incidentId: (created.rows[0] as { id: string }).id,
        reason: result.failureReason ?? "http_status",
        httpStatus: result.httpStatus,
      });
    } else if (next.event === "close" && open) {
      await client.query(
        `update monitor_incidents set ended_at = $2, end_reason = 'recovered'
         where id = $1`,
        [open.id, result.checkedAt],
      );
      await onEvent(client, {
        ...context,
        type: "incident_closed",
        incidentId: open.id,
        endReason: "recovered",
        downNotified: open.down_notified,
      });
    }
    if (ssl.update) {
      await client.query(
        `update monitors set ssl_host = $2, ssl_issuer = $3, ssl_not_after = $4,
           ssl_state = $5, ssl_reason = $6 where id = $1`,
        [
          input.monitorId,
          ssl.update.host,
          ssl.update.issuer,
          ssl.update.notAfter,
          ssl.update.state,
          ssl.update.reason,
        ],
      );
    }
    if (ssl.event) {
      await onEvent(client, {
        ...context,
        type: "ssl_level_entered",
        ...ssl.event,
      });
    }
    return "recorded";
  });
}

type SslUpdate = {
  host: string | null;
  issuer: string | null;
  notAfter: Date | null;
  state: string;
  reason: string | null;
};

/**
 * SSL state of the last hop's hostname, per (ssl_host, ssl_not_after). A check
 * that never reached a handshake (network failure, check_error) keeps the
 * previous state. An event fires when the level worsens into caution, danger
 * or expired for a certificate identity, and again for a new identity that
 * starts in one of them; Task 09 decides what to notify.
 */
function nextSsl(
  monitor: LockedMonitor,
  result: CheckResult,
): {
  update: SslUpdate | null;
  event: {
    level: "caution" | "danger" | "expired";
    host: string;
    notAfter: Date;
  } | null;
} {
  const none = { update: null, event: null };
  if (result.outcome === "check_error") return none;
  const { tls } = result;
  if (tls?.notAfter) {
    const { level } = sslLevel(tls.notAfter, result.checkedAt);
    const update: SslUpdate = {
      host: tls.host,
      issuer: tls.issuer,
      notAfter: tls.notAfter,
      state: level,
      reason: result.tlsReason,
    };
    const sameCertificate =
      monitor.ssl_host === tls.host &&
      monitor.ssl_not_after?.getTime() === tls.notAfter.getTime();
    if (level === "ok" || (sameCertificate && monitor.ssl_state === level)) {
      return { update, event: null };
    }
    return { update, event: { level, host: tls.host, notAfter: tls.notAfter } };
  }
  if (tls) {
    // An expired certificate fails the handshake before its dates can be
    // read. The expiry stored from earlier checks of the same host still
    // applies, so the level can still be entered.
    if (result.tlsReason === "expired") {
      const sameHost = monitor.ssl_host === tls.host;
      const notAfter = sameHost ? monitor.ssl_not_after : null;
      return {
        update: {
          host: tls.host,
          issuer: sameHost ? monitor.ssl_issuer : null,
          notAfter,
          state: "expired",
          reason: "expired",
        },
        event:
          notAfter && monitor.ssl_state !== "expired"
            ? { level: "expired", host: tls.host, notAfter }
            : null,
      };
    }
    return {
      update: {
        host: tls.host,
        issuer: null,
        notAfter: null,
        state: "unreadable",
        reason: result.tlsReason,
      },
      event: null,
    };
  }
  if (result.httpStatus !== null) {
    return {
      update: {
        host: null,
        issuer: null,
        notAfter: null,
        state: "not_https",
        reason: null,
      },
      event: null,
    };
  }
  return none;
}

/**
 * Streak and incident rules (Jobs, Incident). Only pass and fail move the
 * streak; `check_error` leaves it as it was. Every recorded result belongs to
 * the monitor's current check config, because a result of an older config
 * loses the claim guard, so a pass here may close an incident carried over
 * from an old config.
 */
function nextState(
  monitor: LockedMonitor,
  incidentOpen: boolean,
  input: RecordInput,
): {
  consecutiveFailures: number;
  lastPassedConfigVersion: number | null;
  event: "open" | "close" | null;
} {
  const { outcome } = input.result;
  if (outcome === "pass") {
    return {
      consecutiveFailures: 0,
      lastPassedConfigVersion: input.checkConfigVersion,
      event: incidentOpen ? "close" : null,
    };
  }
  if (outcome === "fail") {
    const failures = monitor.consecutive_failures + 1;
    return {
      consecutiveFailures: failures,
      lastPassedConfigVersion: monitor.last_passed_config_version,
      event: failures >= 2 && !incidentOpen ? "open" : null,
    };
  }
  return {
    consecutiveFailures: monitor.consecutive_failures,
    lastPassedConfigVersion: monitor.last_passed_config_version,
    event: null,
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** One row per (monitor, UTC hour of scheduled_for); check_error is not part of uptime. */
async function upsertRollup(
  client: TenantClient,
  input: RecordInput,
): Promise<void> {
  const { result } = input;
  const hourStart = new Date(
    Math.floor(input.scheduledFor.getTime() / HOUR_MS) * HOUR_MS,
  );
  const responseMs =
    result.responseTimeMs === null ? null : Math.round(result.responseTimeMs);
  await client.query(
    `insert into monitor_check_hourly
       (monitor_id, tenant_id, hour_start, checks, passed, covered_seconds,
        response_ms_sum, response_ms_max)
     values ($1, $2, $3, 1, $4, $5, $6, $7)
     on conflict (monitor_id, hour_start) do update set
       checks = monitor_check_hourly.checks + 1,
       passed = monitor_check_hourly.passed + excluded.passed,
       covered_seconds = monitor_check_hourly.covered_seconds + excluded.covered_seconds,
       response_ms_sum = monitor_check_hourly.response_ms_sum + excluded.response_ms_sum,
       response_ms_max = greatest(monitor_check_hourly.response_ms_max, excluded.response_ms_max)`,
    [
      input.monitorId,
      input.tenantId,
      hourStart,
      result.outcome === "pass" ? 1 : 0,
      input.intervalSeconds,
      responseMs ?? 0,
      responseMs,
    ],
  );
}

async function insertResult(
  client: TenantClient,
  input: RecordInput,
): Promise<boolean> {
  const { result } = input;
  const inserted = await client.query(
    `insert into monitor_check_results
       (monitor_id, tenant_id, scheduled_for, checked_at, outcome, http_status,
        response_time_ms, failure_reason, tls_reason, assertions, url_masked,
        check_config_version, interval_seconds, evaluated_from_prefix)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
     on conflict (monitor_id, scheduled_for) do nothing`,
    [
      input.monitorId,
      input.tenantId,
      input.scheduledFor,
      result.checkedAt,
      result.outcome,
      result.httpStatus,
      result.responseTimeMs === null ? null : Math.round(result.responseTimeMs),
      result.failureReason,
      result.tlsReason,
      JSON.stringify(result.assertions),
      result.url,
      input.checkConfigVersion,
      input.intervalSeconds,
      result.evaluatedFromPrefix,
    ],
  );
  return inserted.rowCount === 1;
}
