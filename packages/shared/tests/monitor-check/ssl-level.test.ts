import { describe, expect, it } from "vitest";

import { sslLevel } from "../../src/monitor-check";

const NOW = new Date("2026-09-30T00:00:00.000Z");
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("sslLevel", () => {
  it.each([
    ["31 days", 31 * DAY, "ok", 31],
    ["30 days + 1 s", 30 * DAY + 1000, "ok", 31],
    ["30 days exactly", 30 * DAY, "caution", 30],
    ["7 days + 1 s", 7 * DAY + 1000, "caution", 8],
    ["7 days exactly", 7 * DAY, "danger", 7],
    ["1 s left", 1000, "danger", 1],
    ["0 s left", 0, "expired", 0],
    ["1 s ago", -1000, "expired", 0],
    ["3 days ago", -3 * DAY, "expired", -3],
  ] as const)("%s is %s", (_name, offset, level, daysRemaining) => {
    expect(sslLevel(at(offset), NOW)).toEqual({ level, daysRemaining });
  });
});
