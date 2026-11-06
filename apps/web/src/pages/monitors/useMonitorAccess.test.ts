import { describe, expect, it } from "vitest";

import { ApiError } from "../../lib/api/client";
import { monitorReadPollInterval } from "./useMonitorAccess";

describe("monitorReadPollInterval", () => {
  it.each([
    ["MEMBERSHIP_DENIED", 403],
    ["PERMISSION_DENIED", 403],
    ["MONITOR_NOT_FOUND", 404],
    ["PROJECT_NOT_FOUND", 404],
  ])("stops for %s", (code, status) => {
    expect(monitorReadPollInterval(new ApiError(code, "denied", status))).toBe(
      false,
    );
  });

  it.each([
    null,
    undefined,
    new Error("offline"),
    { code: "PERMISSION_DENIED", status: 403 },
    new ApiError("NETWORK_ERROR", "offline", 0),
    new ApiError("HTTP_403", "forbidden", 403),
    new ApiError("HTTP_404", "missing", 404),
    new ApiError("HTTP_500", "failed", 500),
    new ApiError("CONTRACT_MISMATCH", "invalid", 200),
    new ApiError("OTHER", "denied", 403),
  ])("continues at 30 seconds for nonterminal error %j", (error) => {
    expect(monitorReadPollInterval(error)).toBe(30_000);
  });
});
