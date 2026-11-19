import { describe, expect, it } from "vitest";

import { computeHealth, computeSsl, type HealthFacts } from "./health";

const INTERVAL = 300;

function facts(overrides: Partial<HealthFacts> = {}): HealthFacts {
  return {
    status: "active",
    checkConfigVersion: 1,
    intervalSeconds: INTERVAL,
    consecutiveFailures: 0,
    lastPassedConfigVersion: 1,
    hasOpenIncident: false,
    latest: {
      outcome: "pass",
      configVersion: 1,
      ageSeconds: 10,
      predatesResume: false,
    },
    ...overrides,
  };
}

const latest = (
  outcome: "pass" | "fail" | "check_error",
  ageSeconds = 10,
  configVersion = 1,
  predatesResume = false,
) => ({ outcome, configVersion, ageSeconds, predatesResume });

describe("computeHealth, in the order of the seven steps", () => {
  it.each<
    [
      label: string,
      overrides: Partial<HealthFacts>,
      expected: ReturnType<typeof computeHealth>,
    ]
  >([
    [
      "1: a paused monitor is paused whatever its results say",
      { status: "paused", hasOpenIncident: true, latest: null },
      { health: "paused", healthReason: null, lastKnownDown: false },
    ],
    [
      "2: no result at all is never_checked",
      { latest: null },
      {
        health: "unknown",
        healthReason: "never_checked",
        lastKnownDown: false,
      },
    ],
    [
      "2: only results of an older config is awaiting_new_config, with lastKnownDown while an incident is open [hasOpenIncident=false]",
      {
        checkConfigVersion: 2,
        lastPassedConfigVersion: 1,
        latest: latest("fail", 10, 1),
      },
      {
        health: "unknown",
        healthReason: "awaiting_new_config",
        lastKnownDown: false,
      },
    ],
    [
      "2: only results of an older config is awaiting_new_config, with lastKnownDown while an incident is open [hasOpenIncident=true]",
      {
        checkConfigVersion: 2,
        lastPassedConfigVersion: 1,
        hasOpenIncident: true,
        latest: latest("fail", 10, 1),
      },
      {
        health: "unknown",
        healthReason: "awaiting_new_config",
        lastKnownDown: true,
      },
    ],
    [
      "3: a result exactly 2 x interval old is still fresh, 1 s older is stale [ageSeconds=600]",
      { latest: latest("pass", 2 * INTERVAL) },
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
    [
      "3: a result exactly 2 x interval old is still fresh, 1 s older is stale [ageSeconds=601]",
      { latest: latest("pass", 2 * INTERVAL + 1) },
      { health: "unknown", healthReason: "stale", lastKnownDown: false },
    ],
    [
      "3: a fresh pass from before the last Resume is unknown until a newer result [predatesResume=true]",
      { latest: latest("pass", 10, 1, true) },
      { health: "unknown", healthReason: "stale", lastKnownDown: false },
    ],
    [
      "3: a fresh pass from before the last Resume is unknown until a newer result [predatesResume=false]",
      { latest: latest("pass", 10, 1, false) },
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
    [
      "3: a config awaiting its first result outranks the Resume rule",
      { checkConfigVersion: 2, latest: latest("pass", 10, 1, true) },
      {
        health: "unknown",
        healthReason: "awaiting_new_config",
        lastKnownDown: false,
      },
    ],
    [
      "3: stale with an open incident keeps lastKnownDown [ageSeconds=601]",
      { hasOpenIncident: true, latest: latest("fail", 2 * INTERVAL + 1) },
      { health: "unknown", healthReason: "stale", lastKnownDown: true },
    ],
    [
      "3: stale with an open incident keeps lastKnownDown [ageSeconds=600]",
      { hasOpenIncident: true, latest: latest("fail", 2 * INTERVAL) },
      { health: "down", healthReason: null, lastKnownDown: false },
    ],
    [
      "4: a check_error latest is unknown even with an open incident [hasOpenIncident=false]",
      { latest: latest("check_error") },
      { health: "unknown", healthReason: "check_error", lastKnownDown: false },
    ],
    [
      "4: a check_error latest is unknown even with an open incident [hasOpenIncident=true]",
      { hasOpenIncident: true, latest: latest("check_error") },
      { health: "unknown", healthReason: "check_error", lastKnownDown: true },
    ],
    [
      "5: an open incident with a fresh fail is down",
      {
        hasOpenIncident: true,
        consecutiveFailures: 2,
        latest: latest("fail"),
      },
      { health: "down", healthReason: null, lastKnownDown: false },
    ],
    [
      "6: a passing latest is up",
      {},
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
    [
      "6: one failure after a pass in the current config is still up",
      { consecutiveFailures: 1, latest: latest("fail") },
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
    [
      "7: the first failure of a new config is unknown (no reason)",
      {
        checkConfigVersion: 2,
        lastPassedConfigVersion: 1,
        consecutiveFailures: 1,
        latest: latest("fail", 10, 2),
      },
      { health: "unknown", healthReason: null, lastKnownDown: false },
    ],
    [
      "7: two failures without an incident row is still up [consecutiveFailures=2]",
      { consecutiveFailures: 2, latest: latest("fail") },
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
    [
      "7: two failures without an incident row is still up [consecutiveFailures=50]",
      { consecutiveFailures: 50, latest: latest("fail") },
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
    [
      "an Edit that changes the failure threshold never flips health to unknown on its own (P60-06)",
      { consecutiveFailures: 3, latest: latest("fail") },
      { health: "up", healthReason: null, lastKnownDown: false },
    ],
  ])("%s", (_label, overrides, expected) => {
    expect(computeHealth(facts(overrides))).toEqual(expected);
  });
});

describe("computeSsl", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const base = { host: "a.test", issuer: "CA", state: "ok", reason: null };
  const after = (ms: number) => new Date(now.getTime() + ms);
  const DAY = 86_400_000;

  it.each([
    ["30 d exactly", 30 * DAY, "caution", 30],
    ["30 d + 1 s", 30 * DAY + 1000, "ok", 31],
    ["7 d exactly", 7 * DAY, "danger", 7],
    ["7 d + 1 s", 7 * DAY + 1000, "caution", 8],
    ["expired 1 s ago", -1000, "expired", 0],
    ["expiring now", 0, "expired", 0],
  ] as const)("%s", (_label, offset, level, daysRemaining) => {
    expect(computeSsl({ ...base, notAfter: after(offset) }, now)).toEqual({
      level,
      daysRemaining,
    });
  });

  it("ignores a recorded date-derived level when the expiry is known", () => {
    expect(
      computeSsl({ ...base, state: "danger", notAfter: after(90 * DAY) }, now)
        .level,
    ).toBe("ok");
  });

  it.each(["unreadable", "not_https"] as const)(
    "reports %s as recorded even though an old expiry is kept",
    (state) => {
      expect(
        computeSsl(
          {
            ...base,
            state,
            reason: "handshake_failed",
            notAfter: after(60 * DAY),
          },
          now,
        ),
      ).toEqual({ level: state, daysRemaining: null });
    },
  );

  it.each([
    ["expired", "expired"],
    ["not_https", "not_https"],
    ["unreadable", "unreadable"],
    ["no_data", "no_data"],
    [null, "no_data"],
    ["ok", "no_data"],
  ] as const)("without an expiry, state %s is %s", (state, level) => {
    expect(computeSsl({ ...base, state, notAfter: null }, now)).toEqual({
      level,
      daysRemaining: null,
    });
  });
});
