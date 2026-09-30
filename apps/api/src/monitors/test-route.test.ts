import type { CheckResult } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { sslOfCheck } from "./test-route";

const DAY = 86_400_000;
const NOW = new Date("2026-01-01T00:00:00Z");

function check(overrides: Partial<CheckResult>): CheckResult {
  return {
    outcome: "pass",
    checkedAt: NOW,
    httpStatus: 200,
    responseTimeMs: 5,
    failureReason: null,
    tlsReason: null,
    assertions: [],
    url: "https://host.example/",
    evaluatedFromPrefix: false,
    tls: null,
    ...overrides,
  };
}

const withExpiry = (msFromNow: number, overrides: Partial<CheckResult> = {}) =>
  check({
    tls: {
      host: "host.example",
      issuer: "CN=Example CA",
      notAfter: new Date(NOW.getTime() + msFromNow),
    },
    ...overrides,
  });

describe("sslOfCheck", () => {
  it.each([
    ["30 days + 1 s", 30 * DAY + 1000, "ok", 31],
    ["30 days", 30 * DAY, "caution", 30],
    ["7 days + 1 s", 7 * DAY + 1000, "caution", 8],
    ["7 days", 7 * DAY, "danger", 7],
    ["1 s", 1000, "danger", 1],
    ["now", 0, "expired", 0],
    ["3 days ago", -3 * DAY, "expired", -3],
  ])("%s left is %s", (_label, msLeft, level, days) => {
    expect(sslOfCheck(withExpiry(msLeft))).toMatchObject({
      level,
      daysRemaining: days,
      host: "host.example",
      issuer: "CN=Example CA",
    });
  });

  it("keeps the level of a readable certificate when the check failed on trust", () => {
    const ssl = sslOfCheck(
      withExpiry(100 * DAY, {
        outcome: "fail",
        httpStatus: null,
        failureReason: "tls_invalid",
        tlsReason: "hostname_mismatch",
      }),
    );
    expect(ssl.level).toBe("ok");
  });

  it("has a level but no dates for an expired certificate that could not be read", () => {
    const ssl = sslOfCheck(
      check({
        outcome: "fail",
        httpStatus: null,
        failureReason: "tls_invalid",
        tlsReason: "expired",
        tls: { host: "host.example", issuer: null, notAfter: null },
      }),
    );
    expect(ssl).toEqual({
      level: "expired",
      daysRemaining: null,
      host: "host.example",
      issuer: null,
      notAfter: null,
    });
  });

  it("is unreadable when the handshake gave no certificate", () => {
    const ssl = sslOfCheck(
      check({
        outcome: "fail",
        httpStatus: null,
        failureReason: "tls_invalid",
        tlsReason: "handshake_failed",
        tls: { host: "host.example", issuer: null, notAfter: null },
      }),
    );
    expect(ssl).toMatchObject({ level: "unreadable", host: "host.example" });
  });

  it("is not_https for a response without TLS, no_data for no attempt or a check error", () => {
    expect(sslOfCheck(check({})).level).toBe("not_https");
    expect(sslOfCheck(check({ outcome: "fail", httpStatus: null })).level).toBe(
      "no_data",
    );
    expect(
      sslOfCheck(withExpiry(100 * DAY, { outcome: "check_error" })).level,
    ).toBe("no_data");
  });
});
