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
