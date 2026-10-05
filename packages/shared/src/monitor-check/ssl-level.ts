const DAY_MS = 24 * 60 * 60 * 1000;

export type SslLevel = "ok" | "caution" | "danger" | "expired";

/**
 * Both dates must be valid; an invalid `Date` yields NaN days and level `ok`.
 * `daysRemaining` rounds up, so exactly 30 days is caution, 30 days + 1 s is ok,
 * exactly 7 days is danger and 7 days + 1 s is caution.
 */
export function sslLevel(
  notAfter: Date,
  now: Date,
): { level: SslLevel; daysRemaining: number } {
  const remainingMs = notAfter.getTime() - now.getTime();
  // `+ 0` turns -0 into 0.
  const daysRemaining = Math.ceil(remainingMs / DAY_MS) + 0;
  if (remainingMs <= 0) return { level: "expired", daysRemaining };
  if (daysRemaining <= 7) return { level: "danger", daysRemaining };
  if (daysRemaining <= 30) return { level: "caution", daysRemaining };
  return { level: "ok", daysRemaining };
}

/**
 * Notification-only variant of `sslLevel` (issue #60, OD-60-04, OD-60-05):
 * the caution edge is the monitor's own `cautionDays` (validated elsewhere to
 * 8 to 30) instead of the fixed 30. The danger edge (7 days) and expired stay
 * fixed, matching `sslLevel`. Rounding is identical: `daysRemaining` rounds
 * up, so exactly `cautionDays` is caution, `cautionDays` + 1 s is ok, exactly
 * 7 days is danger and 7 days + 1 s is caution. At `cautionDays === 30` this
 * returns the same result as `sslLevel` for every input.
 *
 * Does not affect the displayed `sslLevel`, `ssl_state`, or
 * `SSL_LEVEL_LEAD_DAYS` (recent events); those stay on the fixed 30/7 edges.
 */
export function sslNotifyLevel(
  notAfter: Date,
  now: Date,
  cautionDays: number,
): { level: SslLevel; daysRemaining: number } {
  const remainingMs = notAfter.getTime() - now.getTime();
  // `+ 0` turns -0 into 0.
  const daysRemaining = Math.ceil(remainingMs / DAY_MS) + 0;
  if (remainingMs <= 0) return { level: "expired", daysRemaining };
  if (daysRemaining <= 7) return { level: "danger", daysRemaining };
  if (daysRemaining <= cautionDays) return { level: "caution", daysRemaining };
  return { level: "ok", daysRemaining };
}
