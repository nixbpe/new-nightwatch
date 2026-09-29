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
  if (latest.ageSeconds > 2 * facts.intervalSeconds) return unknown("stale");
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
  /** Level recorded at the last check; used only when no expiry date is known. */
  state: string | null;
  reason: string | null;
};

export type SslView = {
  level: SslLevelName;
  daysRemaining: number | null;
};

const RECORDED_LEVELS = ["expired", "not_https", "unreadable"] as const;

/**
 * The level is recomputed from the expiry and the database time on every
 * request: the stored state was true at the last check and time has passed.
 */
export function computeSsl(facts: SslFacts, now: Date): SslView {
  if (facts.notAfter !== null) return sslLevel(facts.notAfter, now);
  const recorded = RECORDED_LEVELS.find((level) => level === facts.state);
  return { level: recorded ?? "no_data", daysRemaining: null };
}
