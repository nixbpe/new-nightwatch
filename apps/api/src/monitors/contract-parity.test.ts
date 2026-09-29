import {
  ASSERTION_REASONS,
  CHECK_FAILURE_REASONS,
  isAllowedMonitorPort,
  isForbiddenMonitorHeaderName,
  MONITOR_FORBIDDEN_HEADER_NAMES,
  MONITOR_METHODS,
  MONITOR_URL_MAX_LENGTH,
  TLS_REASONS,
  checkMonitorUrl,
  type StoredAssertion,
} from "@nightwatch/api-contract";
import {
  ASSERTION_REASONS as SHARED_ASSERTION_REASONS,
  CHECK_FAILURE_REASONS as SHARED_CHECK_FAILURE_REASONS,
  TLS_REASONS as SHARED_TLS_REASONS,
  findInvalidHeader,
  validateOutboundUrl,
  type MonitorMethod,
  type NormalizedAssertion,
} from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

// The contract is browser-safe and cannot import packages/shared, so the API
// (which imports both) pins the duplicated rules to each other (PKG-01).
describe("contract and packages/shared agree", () => {
  it("forbid the same header names, prefix and characters", () => {
    for (const name of MONITOR_FORBIDDEN_HEADER_NAMES) {
      for (const variant of [name, name.toUpperCase()]) {
        expect(findInvalidHeader({ [variant]: "v" })).toBe(variant);
        expect(isForbiddenMonitorHeaderName(variant)).toBe(true);
      }
    }
    for (const name of ["Proxy-Authorization", "proxy-x", "PROXY-CONNECTION"]) {
      expect(findInvalidHeader({ [name]: "v" })).toBe(name);
      expect(isForbiddenMonitorHeaderName(name)).toBe(true);
    }
    for (const name of ["Authorization", "X-Api-Key", "Accept", "proxy"]) {
      expect(findInvalidHeader({ [name]: "v" })).toBeNull();
      expect(isForbiddenMonitorHeaderName(name)).toBe(false);
    }
  });

  it("apply the same port rule to every port", () => {
    for (let port = 1; port <= 65535; port += 1) {
      const shared = validateOutboundUrl(`http://example.com:${String(port)}/`);
      expect(isAllowedMonitorPort(port), `port ${String(port)}`).toBe(
        shared.ok,
      );
    }
  });

  it("apply the same URL length limit, scheme, userinfo and port rules", () => {
    const url = (length: number) =>
      `https://example.com/${"a".repeat(length - "https://example.com/".length)}`;
    expect(MONITOR_URL_MAX_LENGTH).toBe(2048);
    for (const length of [2048, 2049]) {
      expect(checkMonitorUrl(url(length)).ok).toBe(
        validateOutboundUrl(url(length)).ok,
      );
    }
    for (const raw of [
      "ftp://example.com/",
      "https://u:p@example.com/",
      "https://example.com:1023/",
      "not a url",
      "https://example.com:443/",
    ]) {
      expect(checkMonitorUrl(raw).ok, raw).toBe(validateOutboundUrl(raw).ok);
    }
  });

  it("list the same failure, TLS and assertion reasons", () => {
    expect([...CHECK_FAILURE_REASONS]).toEqual([
      ...SHARED_CHECK_FAILURE_REASONS,
    ]);
    expect([...TLS_REASONS]).toEqual([...SHARED_TLS_REASONS]);
    expect([...ASSERTION_REASONS]).toEqual([...SHARED_ASSERTION_REASONS]);
  });

  it("list the methods and assertion shapes the executor accepts", () => {
    const methods: readonly MonitorMethod[] = MONITOR_METHODS;
    expect(methods).toHaveLength(6);
    // Stored assertions carry extra typed text, so the executor type accepts them as-is.
    const stored: StoredAssertion = {
      kind: "jsonPathEquals",
      path: "$.a",
      expected: "1",
      pathSegments: ["a"],
      expectedValue: 1,
    };
    const executable: NormalizedAssertion = stored;
    expect(executable.kind).toBe("jsonPathEquals");
  });
});
