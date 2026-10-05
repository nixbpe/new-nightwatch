import { describe, expect, it } from "vitest";

import { sslLevel, sslNotifyLevel } from "../../src/monitor-check";

const NOW = new Date("2026-09-30T00:00:00.000Z");
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const SSL_LEVEL_CASES = [
  ["31 days", 31 * DAY, "ok", 31],
  ["30 days + 1 s", 30 * DAY + 1000, "ok", 31],
  ["30 days exactly", 30 * DAY, "caution", 30],
  ["7 days + 1 s", 7 * DAY + 1000, "caution", 8],
  ["7 days exactly", 7 * DAY, "danger", 7],
  ["1 s left", 1000, "danger", 1],
  ["0 s left", 0, "expired", 0],
  ["1 s ago", -1000, "expired", 0],
  ["3 days ago", -3 * DAY, "expired", -3],
] as const;

describe("sslLevel", () => {
  it.each(SSL_LEVEL_CASES)(
    "%s is %s",
    (_name, offset, level, daysRemaining) => {
      expect(sslLevel(at(offset), NOW)).toEqual({ level, daysRemaining });
    },
  );
});

describe("sslNotifyLevel", () => {
  // issue #60, OD-60-04 / OD-60-05: caution edge is the monitor's own
  // `cautionDays` (here 15, inside the validated 8-30 range); danger (7
  // days) and expired stay fixed like `sslLevel`.
  it.each([
    ["15 days exactly", "caution", 15 * DAY, 15],
    ["15 days + 1 s", "ok", 15 * DAY + 1000, 16],
    ["7 days exactly", "danger", 7 * DAY, 7],
    ["7 days + 1 s", "caution", 7 * DAY + 1000, 8],
    ["0 s left", "expired", 0, 0],
    ["3 days ago", "expired", -3 * DAY, -3],
  ] as const)(
    "cautionDays=15, %s is %s",
    (_name, level, offset, daysRemaining) => {
      expect(sslNotifyLevel(at(offset), NOW, 15)).toEqual({
        level,
        daysRemaining,
      });
    },
  );

  it.each(SSL_LEVEL_CASES)(
    "cautionDays=30 matches sslLevel for %s",
    (_name, offset) => {
      expect(sslNotifyLevel(at(offset), NOW, 30)).toEqual(
        sslLevel(at(offset), NOW),
      );
    },
  );
});
