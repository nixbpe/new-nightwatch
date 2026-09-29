import { describe, expect, it } from "vitest";

import {
  CHECK_FAILURE_REASONS,
  createRedactor,
  outcomeForFailure,
} from "../../src/monitor-check";

describe("createRedactor", () => {
  it.each([
    ["a 1-character secret", ["a"], "banana", "b•••n•••n•••"],
    ["a 2-character secret", ["xy"], "axyb xy", "a•••b •••"],
    ["overlapping secrets", ["abc", "bcd"], "abcd", "•••"],
    ["nested secrets", ["abcd", "bc"], "xabcdx", "x•••x"],
    ["a chained overlap", ["ab", "bc", "cd"], "abcd-ab", "•••-•••"],
    [
      "regex-special characters",
      ["a.b*(c)[d]+?$^|\\"],
      "x a.b*(c)[d]+?$^|\\ y",
      "x ••• y",
    ],
    ["a dot that must not match any character", ["a.c"], "abc a.c", "abc •••"],
    ["no secret", [], "plain", "plain"],
    ["an empty secret", [""], "plain", "plain"],
  ])("masks %s", (_name, secrets, text, expected) => {
    expect(createRedactor(secrets)(text)).toBe(expected);
  });

  it("masks the JSON-escaped form of a secret with a quote and a backslash", () => {
    const secret = 'pa"ss\\word';
    const reflected = JSON.stringify({ echo: `token=${secret}` });
    const out = createRedactor([secret])(reflected);
    expect(out).toBe('{"echo":"token=•••"}');
  });

  it("masks the URL-encoded form of a secret", () => {
    const secret = "p@ss w/rd&x=1";
    const out = createRedactor([secret])(`q=${encodeURIComponent(secret)}`);
    expect(out).toBe("q=•••");
  });

  it("masks the extra base64 form beside the secrets", () => {
    const basic = Buffer.from("alice:pw").toString("base64");
    const out = createRedactor(
      ["alice", "pw"],
      [basic],
    )(`Authorization: Basic ${basic} user=alice`);
    expect(out).toBe("Authorization: Basic ••• user=•••");
  });

  it("masks Bearer and apiKey values in a reflected header block", () => {
    const head =
      "GET / HTTP/1.1\r\nAuthorization: Bearer tok-123\r\nX-Api-Key: key-456\r\n";
    const out = createRedactor(["tok-123", "key-456"])(head);
    expect(out).not.toMatch(/tok-123|key-456/);
    expect(out).toContain("Bearer •••");
    expect(out).toContain("X-Api-Key: •••");
  });
});

describe("outcomeForFailure", () => {
  it.each(CHECK_FAILURE_REASONS)("classifies %s", (reason) => {
    const checkError = [
      "secret_decrypt_failed",
      "internal_egress_failed",
      "resolver_unavailable",
      "executor_error",
    ];
    expect(outcomeForFailure(reason)).toBe(
      checkError.includes(reason) ? "check_error" : "fail",
    );
  });

  it("covers every reason of the Classification table", () => {
    expect([...CHECK_FAILURE_REASONS].sort()).toEqual(
      [
        "http_status",
        "assertion_failed",
        "timeout",
        "dns_not_found",
        "connect_refused",
        "connect_failed",
        "tls_invalid",
        "blocked_address",
        "redirect_blocked",
        "redirect_limit",
        "body_read_failed",
        "secret_decrypt_failed",
        "internal_egress_failed",
        "resolver_unavailable",
        "executor_error",
      ].sort(),
    );
  });
});
