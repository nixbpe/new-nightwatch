import type {
  MonitorHealthReason,
  SslLevelName,
} from "@nightwatch/api-contract";
import { sslLevel } from "@nightwatch/shared";

export type HealthFacts = {
  status: "active" | "paused";
  checkConfigVersion: number;
  intervalSeconds: number;
  consecutiveFailures: number;
  lastPassedConfigVersion: number | null;
  hasOpenIncident: boolean;
  /**
   * Newest result of the monitor under any config version. `ageSeconds` is
   * `now() - checked_at` measured by the database, so the freshness boundary
   * does not lose precision in a JavaScript Date.
   */
  latest: {
    outcome: "pass" | "fail" | "check_error";
    configVersion: number;
    ageSeconds: number;
    /** A `resumed` event is newer than this result (AC-19). */
    predatesResume: boolean;
  } | null;
};

export type Health = {
  health: "up" | "down" | "unknown" | "paused";
  healthReason: MonitorHealthReason;
  /** True only while unknown and an incident is still open (Jobs, State and health). */
  lastKnownDown: boolean;
};

/**
 * The seven steps of Jobs, State and health, in their order. A result is stale
 * only when it is older than 2 x interval; exactly 2 x interval is still fresh.
 */
export function computeHealth(facts: HealthFacts): Health {
  const unknown = (healthReason: MonitorHealthReason): Health => ({
    health: "unknown",
    healthReason,
    lastKnownDown: facts.hasOpenIncident,
  });
  const decided = (health: "up" | "down" | "paused"): Health => ({
    health,
    healthReason: null,
    lastKnownDown: false,
  });

  if (facts.status === "paused") return decided("paused");

  const { latest } = facts;
  if (latest === null) return unknown("never_checked");
  // A result of an older config does not describe the current one (AC-40).
  if (latest.configVersion !== facts.checkConfigVersion) {
    return unknown("awaiting_new_config");
  }
  // A result from before the last Resume does not describe the monitor now
  // (AC-19); it reads as "no new result" until a check runs after the Resume.
  if (latest.predatesResume || latest.ageSeconds > 2 * facts.intervalSeconds) {
    return unknown("stale");
  }
  if (latest.outcome === "check_error") return unknown("check_error");
  if (facts.hasOpenIncident) return decided("down");
  const passedInCurrentConfig =
    facts.lastPassedConfigVersion === facts.checkConfigVersion;
  if (
    latest.outcome === "pass" ||
    (facts.consecutiveFailures === 1 && passedInCurrentConfig)
  ) {
    return decided("up");
  }
  return unknown(null);
}

export type SslFacts = {
  host: string | null;
  issuer: string | null;
  notAfter: Date | null;
  /** State recorded at the last check. */
  state: string | null;
  reason: string | null;
};

export type SslView = {
  level: SslLevelName;
  daysRemaining: number | null;
};

// States a check records that do not come from the expiry date. The Worker
// keeps the previous expiry when a certificate is unreadable, so the date is
// stale for these and must not decide the level.
const RECORDED_STATES = ["unreadable", "not_https", "no_data"] as const;

/**
 * The level comes from the expiry and the database time on every request, for
 * the date-derived states (ok, caution, danger, expired). An unreadable or
 * non-https result is reported as recorded. `expired` without a date (the
 * handshake failed on an expired certificate) stays expired.
 */
export function computeSsl(facts: SslFacts, now: Date): SslView {
  const recorded = RECORDED_STATES.find((state) => state === facts.state);
  if (recorded !== undefined) return { level: recorded, daysRemaining: null };
  if (facts.notAfter !== null) return sslLevel(facts.notAfter, now);
  return {
    level: facts.state === "expired" ? "expired" : "no_data",
    daysRemaining: null,
  };
}
