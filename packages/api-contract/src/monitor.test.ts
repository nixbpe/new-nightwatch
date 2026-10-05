import { describe, expect, it } from "vitest";

import {
  checkMonitorUrl,
  canonicalSecretSlot,
  monitorConfigSchema,
  monitorCreateSchema,
  monitorEditSchema,
  monitorHistoryQuerySchema,
  monitorIssueReason,
  monitorListQuerySchema,
  monitorRecentEventsQuerySchema,
  monitorResponseTimesQuerySchema,
  monitorTestCreateSchema,
  monitorTestEditSchema,
  normalizeMonitorConfig,
  parseExpectedStatus,
  parseExpectedValue,
  parseJsonPath,
  type MonitorConfigInput,
} from "./monitor";

const base: MonitorConfigInput = { name: "Site", url: "https://example.com/" };

function reasons(input: Partial<MonitorConfigInput> | Record<string, unknown>) {
  const result = monitorConfigSchema.safeParse({ ...base, ...input });
  if (result.success) return [];
  const first = new Map<string, string>();
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (first.has(path)) continue;
    first.set(
      path,
      issue.code === "custom"
        ? (issue.params as { reason: string }).reason
        : issue.code,
    );
  }
  return [...first].map(([path, reason]) => ({ path, reason }));
}

describe("parseExpectedStatus", () => {
  it("parses codes, ranges and lists into ranges", () => {
    expect(parseExpectedStatus("200-299,301")).toEqual({
      ok: true,
      value: [
        { from: 200, to: 299 },
        { from: 301, to: 301 },
      ],
    });
  });

  it.each([
    ["100", true],
    ["599", true],
    ["99", false],
    ["600", false],
    ["300-200", false],
    ["200-600", false],
  ])("code range boundary %s", (text, ok) => {
    expect(parseExpectedStatus(text).ok).toBe(ok);
  });

  it.each([
    ["", "required"],
    ["abc", "invalid_format"],
    ["200-", "invalid_format"],
    ["200,,201", "invalid_format"],
    ["2000", "invalid_format"],
    ["99", "out_of_range"],
    ["600", "out_of_range"],
    ["300-200", "out_of_range"],
  ])("rejects %j as %s", (text, reason) => {
    expect(parseExpectedStatus(text)).toEqual({ ok: false, reason });
  });

  it("accepts 10 entries and rejects 11", () => {
    const list = (count: number) =>
      Array.from({ length: count }, (_, index) => 200 + index).join(",");
    expect(parseExpectedStatus(list(10)).ok).toBe(true);
    expect(parseExpectedStatus(list(11))).toEqual({
      ok: false,
      reason: "too_many",
    });
  });
});

describe("parseJsonPath", () => {
  it("parses the supported subset into segments", () => {
    expect(parseJsonPath("$.a['b'][0]")).toEqual({
      ok: true,
      value: ["a", "b", 0],
    });
    expect(parseJsonPath("$")).toEqual({ ok: true, value: [] });
  });

  it.each([
    "$.items[?(@.id==1)]",
    "$.items[*]",
    "$.*",
    "$..a",
    "a.b",
    "$.a.",
    "$['a",
    "$[01]",
    "$[-1]",
    "$.a b",
  ])("rejects %j", (path) => {
    expect(parseJsonPath(path)).toEqual({
      ok: false,
      reason: "invalid_jsonpath",
    });
  });

  it("accepts 32 segments and rejects 33", () => {
    const path = (count: number) => `$${".a".repeat(count)}`;
    expect(parseJsonPath(path(32)).ok).toBe(true);
    expect(parseJsonPath(path(33))).toEqual({ ok: false, reason: "too_many" });
  });
});

describe("parseExpectedValue", () => {
  it.each([
    ["1", 1],
    ["true", true],
    ["null", null],
    ['"1"', "1"],
    ["ok", "ok"],
    ["01", "01"],
    ["1e999", "1e999"],
    ["[1]", "[1]"],
  ])("%j becomes %j", (text, value) => {
    expect(parseExpectedValue(text)).toBe(value);
  });
});

describe("checkMonitorUrl", () => {
  it("accepts a URL of exactly 2048 characters and rejects 2049", () => {
    const url = (length: number) =>
      `https://example.com/${"a".repeat(length - "https://example.com/".length)}`;
    expect(checkMonitorUrl(url(2048)).ok).toBe(true);
    expect(checkMonitorUrl(url(2049))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it.each([
    ["", "required"],
    ["not a url", "invalid_format"],
    ["ftp://example.com/", "blocked_scheme"],
    ["https://user:pass@example.com/", "embedded_credentials"],
    ["https://example.com:1023/", "blocked_port"],
    ["https://example.com:65536/", "invalid_format"],
  ])("rejects %j as %s", (url, reason) => {
    expect(checkMonitorUrl(url)).toEqual({ ok: false, reason });
  });
});

describe("monitorConfigSchema", () => {
  it("fills the documented defaults (AC-06)", () => {
    expect(monitorConfigSchema.parse(base)).toEqual({
      ...base,
      intervalSeconds: 300,
      timeoutSeconds: 10,
      method: "GET",
      headers: [],
      queryParams: [],
      body: null,
      expectedStatus: "200-299",
      assertions: [],
      auth: { type: "none" },
      alerts: {
        failureThreshold: 2,
        downEnabled: true,
        sslEnabled: true,
        sslCautionDays: 30,
      },
    });
  });

  it("trims the name and requires it", () => {
    expect(monitorConfigSchema.parse({ ...base, name: "  A  " }).name).toBe(
      "A",
    );
    expect(reasons({ name: "   " })).toEqual([
      { path: "name", reason: "too_small" },
    ]);
  });

  it.each([
    [1, true],
    [30, true],
    [0, false],
    [31, false],
  ])("timeout %i within 1..30 is %s", (timeoutSeconds, ok) => {
    expect(reasons({ timeoutSeconds, intervalSeconds: 60 }).length === 0).toBe(
      ok,
    );
  });

  it("requires an interval of 60, 300 or 900", () => {
    expect(reasons({ intervalSeconds: 120 })).toEqual([
      { path: "intervalSeconds", reason: "out_of_range" },
    ]);
  });

  it("limits headers and query params to 20 rows", () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        name: `x-h${String(index)}`,
        value: "v",
        secret: false,
      }));
    expect(reasons({ headers: rows(20) })).toEqual([]);
    expect(reasons({ headers: rows(21) })).toEqual([
      { path: "headers", reason: "too_big" },
    ]);
    const params = (count: number) =>
      Array.from({ length: count }, () => ({ name: "q", value: "v" }));
    expect(reasons({ queryParams: params(20) })).toEqual([]);
    expect(reasons({ queryParams: params(21) })).toEqual([
      { path: "queryParams", reason: "too_big" },
    ]);
  });

  it("limits header names to 256 characters and values to 4 KiB", () => {
    const header = (name: string, value: string) => [
      { name, value, secret: false },
    ];
    expect(reasons({ headers: header("h".repeat(256), "v") })).toEqual([]);
    expect(reasons({ headers: header("h".repeat(257), "v") })).toEqual([
      { path: "headers.0.name", reason: "too_big" },
    ]);
    expect(reasons({ headers: header("x-a", "v".repeat(4096)) })).toEqual([]);
    expect(reasons({ headers: header("x-a", "v".repeat(4097)) })).toEqual([
      { path: "headers.0.value", reason: "too_big" },
    ]);
    // 2049 two-byte characters are 4098 bytes.
    expect(reasons({ headers: header("x-a", "é".repeat(2049)) })).toEqual([
      { path: "headers.0.value", reason: "too_long" },
    ]);
  });

  it("rejects duplicate, forbidden, malformed and CR/LF headers and auth conflicts", () => {
    const rows = (...names: string[]) =>
      names.map((name) => ({ name, value: "v", secret: false }));
    expect(reasons({ headers: rows("X-A", "x-a") })).toEqual([
      { path: "headers.1.name", reason: "duplicate" },
    ]);
    for (const name of [
      "Host",
      "content-length",
      "Proxy-Authorization",
      "TE",
    ]) {
      expect(reasons({ headers: rows(name) })).toEqual([
        { path: "headers.0.name", reason: "blocked_header" },
      ]);
    }
    expect(reasons({ headers: rows("bad name") })).toEqual([
      { path: "headers.0.name", reason: "invalid_format" },
    ]);
    expect(
      reasons({ headers: [{ name: "x-a", value: "a\r\nb", secret: false }] }),
    ).toEqual([{ path: "headers.0.value", reason: "crlf" }]);
    expect(
      reasons({ auth: { type: "bearer" }, headers: rows("Authorization") }),
    ).toEqual([{ path: "headers.0.name", reason: "auth_header_conflict" }]);
    expect(
      reasons({
        auth: { type: "apiKey", headerName: "X-Key" },
        headers: rows("x-key"),
      }),
    ).toEqual([{ path: "headers.0.name", reason: "auth_header_conflict" }]);
    expect(reasons({ auth: { type: "apiKey", headerName: "Host" } })).toEqual([
      { path: "auth.headerName", reason: "blocked_header" },
    ]);
  });

  it("limits the request body to 64 KiB and validates JSON bodies", () => {
    const body = (type: "json" | "text", content: string) => ({
      method: "POST" as const,
      body: { type, content },
    });
    expect(reasons(body("text", "a".repeat(65536)))).toEqual([]);
    expect(reasons(body("text", "a".repeat(65537)))).toEqual([
      { path: "body.content", reason: "too_big" },
    ]);
    expect(reasons(body("text", "é".repeat(32769)))).toEqual([
      { path: "body.content", reason: "too_long" },
    ]);
    expect(reasons(body("json", '{"a":1}'))).toEqual([]);
    expect(reasons(body("json", "{oops"))).toEqual([
      { path: "body.content", reason: "invalid_json" },
    ]);
  });

  it("limits assertions to 10 and checks each kind", () => {
    const rows = (count: number) =>
      Array.from({ length: count }, () => ({
        kind: "bodyContains" as const,
        text: "ok",
      }));
    expect(reasons({ assertions: rows(10) })).toEqual([]);
    expect(reasons({ assertions: rows(11) })).toEqual([
      { path: "assertions", reason: "too_big" },
    ]);
    expect(
      reasons({
        assertions: [
          { kind: "jsonPathEquals", path: "$.a[*]", expected: "1" },
          { kind: "jsonPathEquals", path: "$.a", expected: "" },
          { kind: "bodyContains", text: "" },
        ],
      }),
    ).toEqual([
      { path: "assertions.0.path", reason: "invalid_jsonpath" },
      { path: "assertions.1.expected", reason: "required" },
      { path: "assertions.2.text", reason: "required" },
    ]);
  });

  it("accepts a response time threshold equal to the timeout and rejects more", () => {
    const at = (ms: number) => ({
      timeoutSeconds: 10,
      assertions: [{ kind: "responseTimeBelow" as const, ms }],
    });
    expect(reasons(at(10000))).toEqual([]);
    expect(reasons(at(10001))).toEqual([
      { path: "assertions.0.ms", reason: "out_of_range" },
    ]);
    expect(reasons(at(0))).toEqual([
      { path: "assertions.0.ms", reason: "too_small" },
    ]);
  });

  it("rejects body assertions with HEAD but keeps response time assertions", () => {
    expect(
      reasons({
        method: "HEAD",
        assertions: [
          { kind: "bodyContains", text: "x" },
          { kind: "jsonPathEquals", path: "$", expected: "1" },
          { kind: "responseTimeBelow", ms: 100 },
        ],
      }),
    ).toEqual([
      { path: "assertions.0.kind", reason: "body_assertion_with_head" },
      { path: "assertions.1.kind", reason: "body_assertion_with_head" },
    ]);
  });

  it("requires a UUID clientRequestId on Create only", () => {
    expect(monitorCreateSchema.safeParse(base).success).toBe(false);
    expect(
      monitorCreateSchema.safeParse({
        ...base,
        clientRequestId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });

  it("reports a missing field with the zod message the API hook relies on", () => {
    const result = monitorConfigSchema.safeParse({ name: "x" });
    expect(result.success ? [] : result.error.issues[0]?.message).toContain(
      "received undefined",
    );
  });
});

describe("alerts (issue #60)", () => {
  it("Test (create and edit shape) accepts a complete alerts object, like Create (rejected and not used)", () => {
    const alerts = {
      failureThreshold: 3,
      downEnabled: false,
      sslEnabled: false,
      sslCautionDays: 8,
    };
    const createShape = monitorTestCreateSchema.safeParse({
      ...base,
      secrets: [],
      alerts,
    });
    expect(createShape.success).toBe(true);
    expect(createShape.success && createShape.data.alerts).toEqual(alerts);

    const editShape = monitorTestEditSchema.safeParse({
      ...base,
      secrets: [],
      alerts,
    });
    expect(editShape.success).toBe(true);
    expect(editShape.success && editShape.data.alerts).toEqual(alerts);
  });

  it("defaults the whole object and each field on Create and Test (AC-06)", () => {
    expect(monitorConfigSchema.parse(base).alerts).toEqual({
      failureThreshold: 2,
      downEnabled: true,
      sslEnabled: true,
      sslCautionDays: 30,
    });
    expect(
      monitorConfigSchema.parse({ ...base, alerts: { downEnabled: false } })
        .alerts,
    ).toEqual({
      failureThreshold: 2,
      downEnabled: false,
      sslEnabled: true,
      sslCautionDays: 30,
    });
  });

  it("Edit without alerts leaves it undefined, so the service keeps the stored value", () => {
    const result = monitorEditSchema.safeParse({
      ...base,
      expectedVersion: 1,
      secrets: [],
    });
    expect(result.success && result.data.alerts).toBeUndefined();
  });

  it("Edit rejects a partial alerts object instead of filling defaults (ครบทั้ง object)", () => {
    const result = monitorEditSchema.safeParse({
      ...base,
      expectedVersion: 1,
      secrets: [],
      alerts: { failureThreshold: 3 },
    });
    expect(result.success).toBe(false);
    const paths = result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        "alerts.downEnabled",
        "alerts.sslEnabled",
        "alerts.sslCautionDays",
      ]),
    );
  });

  it("Edit accepts a complete alerts object", () => {
    const result = monitorEditSchema.safeParse({
      ...base,
      expectedVersion: 1,
      secrets: [],
      alerts: {
        failureThreshold: 3,
        downEnabled: false,
        sslEnabled: false,
        sslCautionDays: 8,
      },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.alerts).toEqual({
      failureThreshold: 3,
      downEnabled: false,
      sslEnabled: false,
      sslCautionDays: 8,
    });
  });
});

describe("storable text", () => {
  const lone = "a\uD800b";
  it.each([
    ["name", { name: "a\0b" }, "name"],
    ["url", { url: "https://example.com/a\0b" }, "url"],
    [
      "body",
      { method: "POST", body: { type: "text", content: "a\0b" } },
      "body.content",
    ],
    [
      "query name",
      { queryParams: [{ name: "a\0", value: "v" }] },
      "queryParams.0.name",
    ],
    [
      "query value",
      { queryParams: [{ name: "q", value: "a\0" }] },
      "queryParams.0.value",
    ],
    [
      "query value with a lone surrogate",
      { queryParams: [{ name: "q", value: lone }] },
      "queryParams.0.value",
    ],
    [
      "header value with NUL",
      { headers: [{ name: "x-a", value: "a\0", secret: false }] },
      "headers.0.value",
    ],
    [
      "header value with a lone surrogate",
      { headers: [{ name: "x-a", value: lone, secret: false }] },
      "headers.0.value",
    ],
    [
      "JSON body with a lone surrogate",
      { method: "POST", body: { type: "json", content: `"${lone}"` } },
      "body.content",
    ],
    [
      "assertion expected",
      {
        assertions: [{ kind: "jsonPathEquals", path: "$.a", expected: "a\0" }],
      },
      "assertions.0.expected",
    ],
    [
      "assertion path",
      {
        assertions: [
          { kind: "jsonPathEquals", path: "$['a\0']", expected: "1" },
        ],
      },
      "assertions.0.path",
    ],
    [
      "assertion text",
      { assertions: [{ kind: "bodyContains", text: lone }] },
      "assertions.0.text",
    ],
  ])("rejects %s as invalid_format", (_label, input, path) => {
    expect(reasons(input)).toEqual([{ path, reason: "invalid_format" }]);
  });

  it("keeps crlf for line breaks in header values and accepts paired surrogates", () => {
    expect(
      reasons({ headers: [{ name: "x-a", value: "a\nb", secret: false }] }),
    ).toEqual([{ path: "headers.0.value", reason: "crlf" }]);
    expect(reasons({ name: "ok \u{1F600}" })).toEqual([]);
  });
});

describe("header ids", () => {
  const id = "0b9d1c62-4f0e-4c55-8a1d-3f2b7c9e1a10";
  const other = "1c0e2d73-5a1f-4d66-9b2e-4a3c8d0f2b21";
  const header = (value?: string) => ({
    ...(value === undefined ? {} : { id: value }),
    name: "x-a",
    secret: true,
  });
  it.each([
    ["NUL", "a\0", "invalid_format"],
    ["a lone surrogate", "\uD800", "invalid_format"],
    ["empty", "", "invalid_format"],
    ["not a UUID", "slot-1", "invalid_format"],
  ])("rejects an id with %s", (_label, value, reason) => {
    expect(reasons({ headers: [header(value)] })).toEqual([
      { path: "headers.0.id", reason },
    ]);
  });

  it("rejects an id shared by two headers, ignoring case", () => {
    expect(
      reasons({
        headers: [header(id), { ...header(id.toUpperCase()), name: "x-b" }],
      }),
    ).toEqual([{ path: "headers.1.id", reason: "duplicate" }]);
  });

  it("accepts distinct UUID ids", () => {
    expect(
      reasons({ headers: [header(id), { ...header(other), name: "x-b" }] }),
    ).toEqual([]);
  });
});

describe("name and url normalization", () => {
  it("accepts a name of 100 characters and rejects 101", () => {
    expect(reasons({ name: "n".repeat(100) })).toEqual([]);
    expect(reasons({ name: "n".repeat(101) })).toEqual([
      { path: "name", reason: "too_big" },
    ]);
  });

  it("trims the url", () => {
    expect(
      monitorConfigSchema.parse({ ...base, url: " https://example.com/ " }).url,
    ).toBe("https://example.com/");
  });
});

describe("normalizeMonitorConfig", () => {
  it("keeps typed text next to the normalized forms", () => {
    const config = monitorConfigSchema.parse({
      ...base,
      expectedStatus: " 200-299, 301 ",
      assertions: [
        { kind: "jsonPathEquals", path: "$.a['b'][0]", expected: '"1"' },
        { kind: "bodyContains", text: "ok" },
        { kind: "responseTimeBelow", ms: 500 },
      ],
    });
    expect(normalizeMonitorConfig(config)).toEqual({
      expectedStatusText: "200-299, 301",
      expectedStatusRanges: [
        { from: 200, to: 299 },
        { from: 301, to: 301 },
      ],
      assertions: [
        {
          kind: "jsonPathEquals",
          path: "$.a['b'][0]",
          expected: '"1"',
          pathSegments: ["a", "b", 0],
          expectedValue: "1",
        },
        { kind: "bodyContains", text: "ok" },
        { kind: "responseTimeBelow", ms: 500 },
      ],
    });
  });
});

describe("read query schemas", () => {
  it("apply the documented defaults to strings from the URL", () => {
    expect(monitorListQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(monitorHistoryQuerySchema.parse({})).toEqual({
      limit: 20,
      offset: 0,
    });
    expect(monitorRecentEventsQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(monitorResponseTimesQuerySchema.parse({})).toEqual({ range: "24h" });
    expect(
      monitorListQuerySchema.parse({
        limit: "50",
        offset: "3",
        health: "down",
      }),
    ).toEqual({ limit: 50, offset: 3, health: "down" });
  });

  it("trim q and bound every number", () => {
    expect(monitorListQuerySchema.parse({ q: "  a_b%  " }).q).toBe("a_b%");
    expect(monitorListQuerySchema.parse({ q: "x".repeat(200) }).q).toHaveLength(
      200,
    );
    for (const bad of [
      { q: "x".repeat(201) },
      { q: "a\0b" },
      { q: "\ud800" },
      { limit: "0" },
      { limit: "51" },
      { limit: "1.5" },
      { offset: "-1" },
      { health: "healthy" },
    ]) {
      expect(monitorListQuerySchema.safeParse(bad).success).toBe(false);
    }
    expect(
      monitorRecentEventsQuerySchema.safeParse({ limit: "21" }).success,
    ).toBe(false);
    expect(
      monitorRecentEventsQuerySchema.safeParse({ limit: "20" }).success,
    ).toBe(true);
    expect(
      monitorResponseTimesQuerySchema.safeParse({ range: "1y" }).success,
    ).toBe(false);
  });
});

describe("secret entries", () => {
  const id = "5b0c1a3e-6f0a-4a57-9c4e-8d1b2a3c4d5e";
  const created = (extra: Record<string, unknown>) =>
    monitorCreateSchema.safeParse({
      ...base,
      clientRequestId: crypto.randomUUID(),
      ...extra,
    });
  const failures = (result: ReturnType<typeof created>) =>
    result.success
      ? []
      : result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          reason:
            issue.code === "custom"
              ? (issue.params as { reason: string }).reason
              : issue.code,
        }));

  it("keeps rejecting a secrets field on the plain config", () => {
    expect(
      monitorConfigSchema.safeParse({
        ...base,
        secrets: [{ slot: "auth.token", value: "x" }],
      }).success,
    ).toBe(false);
  });

  it("accepts Create entries and defaults to none", () => {
    expect(created({}).success).toBe(true);
    expect(
      created({
        headers: [{ id, name: "X-S", secret: true }],
        secrets: [{ slot: `header.${id.toUpperCase()}`, value: "v" }],
      }).success,
    ).toBe(true);
  });

  it("names the entry field and reason for each bad value", () => {
    expect(
      failures(created({ secrets: [{ slot: "auth.other", value: "v" }] })),
    ).toEqual([{ path: "secrets.0.slot", reason: "invalid_format" }]);
    expect(
      failures(
        created({
          secrets: [
            { slot: "auth.token", value: "a" },
            { slot: "auth.token", value: "b" },
          ],
        }),
      ),
    ).toEqual([{ path: "secrets.1.slot", reason: "duplicate" }]);
    expect(
      failures(created({ secrets: [{ slot: "auth.token", value: "a\r\nb" }] })),
    ).toEqual([{ path: "secrets.0.value", reason: "crlf" }]);
    expect(
      failures(
        created({ secrets: [{ slot: "auth.token", value: "é".repeat(2049) }] }),
      ),
    ).toEqual([{ path: "secrets.0.value", reason: "too_long" }]);
  });

  it("rejects a slot in the wrong case and canonicalizes a header UUID", () => {
    const slots = (...names: string[]) =>
      failures(
        created({
          secrets: names.map((slot) => ({ slot, value: "v" })),
        }),
      ).filter((failure) => failure.reason === "invalid_format");
    expect(slots("AUTH.TOKEN")).toHaveLength(1);
    expect(slots(`Header.${id}`)).toHaveLength(1);
    expect(slots(`header.${id.toUpperCase()}`)).toEqual([]);
    expect(canonicalSecretSlot(`header.${id.toUpperCase()}`)).toBe(
      `header.${id}`,
    );
    expect(canonicalSecretSlot("auth.apiKey")).toBe("auth.apiKey");
  });

  it("requires a client-chosen id for a secret header", () => {
    expect(
      failures(created({ headers: [{ name: "X-S", secret: true }] })),
    ).toEqual([{ path: "headers.0.id", reason: "required" }]);
  });

  it("checks Edit actions against their values", () => {
    const edited = (secrets: unknown[]) =>
      monitorEditSchema.safeParse({ ...base, expectedVersion: 1, secrets });
    expect(
      edited([
        { slot: "auth.token", action: "keep" },
        { slot: "auth.password", action: "delete" },
      ]).success,
    ).toBe(true);
    for (const entry of [
      { slot: "auth.token", action: "replace" },
      { slot: "auth.token", action: "replace", value: "" },
      { slot: "auth.token", action: "keep", value: "x" },
      { slot: "auth.token", action: "rotate", value: "x" },
    ]) {
      expect(edited([entry]).success, JSON.stringify(entry)).toBe(false);
    }
  });
});

describe("monitorIssueReason", () => {
  const reasonAt = (input: Record<string, unknown>, path: string) => {
    const result = monitorConfigSchema.safeParse({ ...base, ...input });
    if (result.success) return null;
    const issue = result.error.issues.find(
      (item) => item.path.join(".") === path,
    );
    return issue === undefined ? null : monitorIssueReason(issue);
  };

  it("names one reason for each kind of Zod issue", () => {
    expect(reasonAt({ name: "" }, "name")).toBe("required");
    expect(reasonAt({ name: "x".repeat(101) }, "name")).toBe("too_long");
    expect(reasonAt({ timeoutSeconds: 31 }, "timeoutSeconds")).toBe(
      "out_of_range",
    );
    expect(
      reasonAt(
        {
          headers: Array.from({ length: 21 }, (_, i) => ({
            name: `X-${String(i)}`,
            value: "v",
          })),
        },
        "headers",
      ),
    ).toBe("too_many");
    expect(reasonAt({ timeoutSeconds: "x" }, "timeoutSeconds")).toBe(
      "invalid_format",
    );
    expect(reasonAt({ url: "ftp://example.com" }, "url")).toBe(
      "blocked_scheme",
    );
  });

  it("maps alerts range and type issues the same way (issue #60)", () => {
    expect(
      reasonAt({ alerts: { failureThreshold: 0 } }, "alerts.failureThreshold"),
    ).toBe("out_of_range");
    expect(
      reasonAt({ alerts: { failureThreshold: 4 } }, "alerts.failureThreshold"),
    ).toBe("out_of_range");
    expect(
      reasonAt({ alerts: { sslCautionDays: 7 } }, "alerts.sslCautionDays"),
    ).toBe("out_of_range");
    expect(
      reasonAt({ alerts: { sslCautionDays: 31 } }, "alerts.sslCautionDays"),
    ).toBe("out_of_range");
    expect(
      reasonAt(
        { alerts: { failureThreshold: "2" } },
        "alerts.failureThreshold",
      ),
    ).toBe("invalid_format");
    expect(
      reasonAt({ alerts: { downEnabled: "yes" } }, "alerts.downEnabled"),
    ).toBe("invalid_format");
  });
});
