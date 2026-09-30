import { describe, expect, it, vi } from "vitest";

import {
  CHECK_FAILURE_REASONS,
  ACTUAL_MAX_CHARS,
  createRedactor,
  outcomeForFailure,
  truncateActual,
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

describe("createRedactor with a lone surrogate", () => {
  const secret = "a\uD800b";

  it("does not throw and still masks the raw and JSON-escaped forms", () => {
    const redact = createRedactor([secret]);
    expect(redact(`x ${secret} y`)).toBe("x ••• y");
    expect(redact(JSON.stringify({ v: secret }))).toBe('{"v":"•••"}');
  });

  it("keeps masking the other secrets", () => {
    expect(createRedactor([secret, "plain"])("plain")).toBe("•••");
  });
});

describe("createRedactor work bound for a displayed value", () => {
  const shownOf = (redact: ReturnType<typeof createRedactor>, text: string) =>
    truncateActual(redact(text, ACTUAL_MAX_CHARS));

  it("does bounded work on a 1 MiB scalar with a 1-character secret found 500k times", () => {
    const text = "ab".repeat(512 * 1024);
    const redact = createRedactor(["a"]);
    const indexOf = vi.spyOn(String.prototype, "indexOf");
    let shown;
    let searches;
    try {
      shown = shownOf(redact, text);
      searches = indexOf.mock.calls.length;
    } finally {
      indexOf.mockRestore();
    }
    // One initial search per needle form plus one per occurrence that is actually emitted.
    expect(searches).toBeLessThan(400);
    expect(shown.text).toBe("•••b".repeat(50).slice(0, 200));
    expect(shown.text).not.toContain("a");
    expect(shown.truncated).toBe(true);
  });

  it("returns exactly what the unbounded redactor would show", () => {
    const secrets = ["ab", "bcd", 'q"x'];
    const redact = createRedactor(secrets);
    const texts = [
      "abcd".repeat(300),
      `${"z".repeat(190)}abcd${"y".repeat(300)}`,
      `${"z".repeat(197)}q"x${"y".repeat(50)}`,
      "\u{1F600}".repeat(150) + "ab".repeat(200),
      "short ab",
      "a".repeat(5000),
    ];
    for (const text of texts) {
      expect(shownOf(redact, text)).toEqual(truncateActual(redact(text)));
    }
  });

  it("masks a secret that straddles the 200-character cut", () => {
    const secret = "S3CR3T-VALUE";
    for (const lead of [190, 195, 198, 199, 200]) {
      const text = `${"a".repeat(lead)}${secret}${"b".repeat(400)}`;
      const shown = shownOf(createRedactor([secret]), text).text;
      expect(shown).not.toMatch(/S3C|R3T|VAL|LUE|-V/);
      expect(shown.startsWith("a".repeat(lead))).toBe(true);
    }
  });

  it("keeps a masked range that spans the whole text as one mask", () => {
    const text = "a".repeat(100_000);
    expect(shownOf(createRedactor(["a"]), text)).toEqual({
      text: "•••",
      truncated: false,
    });
  });
});
