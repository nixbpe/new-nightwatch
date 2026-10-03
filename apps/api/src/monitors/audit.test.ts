import type { StoredHeader } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import { editAuditAction, monitorAuditChanges } from "./audit";
import type { StoredConfig } from "./record";

const QUERY_VALUE = "qv-known-secret-1";
const QUERY_VALUE_2 = "qv-known-secret-2";
const BODY_VALUE = "bv-known-secret-1";
const BODY_VALUE_2 = "bv-known-secret-2";
const HEADER_ID = "5b0c1a3e-6f0a-4a57-9c4e-8d1b2a3c4d5e";

const base: StoredConfig = {
  name: "API",
  url: "https://example.test/health",
  method: "GET",
  intervalSeconds: 300,
  timeoutSeconds: 10,
  headers: [],
  queryParams: [],
  bodyType: null,
  bodyContent: null,
  authType: "none",
  apiKeyHeaderName: null,
  expectedStatusText: "200-299",
  expectedStatusRanges: [{ from: 200, to: 299 }],
  assertions: [],
};
const noSecrets = { written: [], stored: new Set<string>(), deleted: [] };
const changesOf = (next: Partial<StoredConfig>, previous = base) =>
  monitorAuditChanges(previous, { ...previous, ...next }, noSecrets);
const value = (v: string | number | boolean | null) => ({
  kind: "value",
  value: v,
});

describe("monitorAuditChanges", () => {
  it("returns nothing for identical configs", () => {
    expect(changesOf({})).toEqual([]);
  });

  it.each([
    ["name", { name: "Renamed" }, "API", "Renamed"],
    ["method", { method: "POST" as const }, "GET", "POST"],
    ["intervalSeconds", { intervalSeconds: 60 }, 300, 60],
    ["timeoutSeconds", { timeoutSeconds: 5 }, 10, 5],
    ["authType", { authType: "bearer" as const }, "none", "bearer"],
    ["expectedStatus", { expectedStatusText: "200" }, "200-299", "200"],
  ])("shows %s before and after", (field, next, before, after) => {
    expect(changesOf(next)).toEqual([
      { field, before: value(before), after: value(after) },
    ]);
  });

  it("shows apiKeyHeaderName with null for no value", () => {
    expect(changesOf({ apiKeyHeaderName: "X-Key" })).toEqual([
      { field: "apiKeyHeaderName", before: null, after: value("X-Key") },
    ]);
  });

  it("masks every query value in the url before and after", () => {
    const changes = changesOf(
      { url: `https://example.test/health?token=${QUERY_VALUE_2}&a=1` },
      { ...base, url: `https://example.test/health?token=${QUERY_VALUE}` },
    );
    expect(changes).toEqual([
      {
        field: "url",
        before: value("https://example.test/health?token=•••"),
        after: value("https://example.test/health?token=•••&a=•••"),
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain(QUERY_VALUE);
    expect(JSON.stringify(changes)).not.toContain(QUERY_VALUE_2);
  });

  it("masks an unparseable stored url past its question mark", () => {
    const changes = monitorAuditChanges(
      { ...base, url: `not a url?k=${QUERY_VALUE}` },
      { ...base, url: "https://example.test/health" },
      noSecrets,
    );
    expect(changes).toEqual([
      {
        field: "url",
        before: value("not a url?•••"),
        after: value("https://example.test/health"),
      },
    ]);
  });

  it("shows query parameters by name as masked, never the value", () => {
    const changes = changesOf(
      {
        queryParams: [
          { name: "edited", value: QUERY_VALUE_2 },
          { name: "added", value: QUERY_VALUE },
          { name: "same", value: "s" },
        ],
      },
      {
        ...base,
        queryParams: [
          { name: "edited", value: QUERY_VALUE },
          { name: "removed", value: QUERY_VALUE },
          { name: "same", value: "s" },
        ],
      },
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        {
          field: "queryParam",
          key: "edited",
          before: { kind: "masked" },
          after: { kind: "masked" },
        },
        {
          field: "queryParam",
          key: "removed",
          before: { kind: "masked" },
          after: null,
        },
        {
          field: "queryParam",
          key: "added",
          before: null,
          after: { kind: "masked" },
        },
      ]),
    );
    expect(changes.some((change) => change.key === "same")).toBe(false);
    const text = JSON.stringify(changes);
    expect(text).not.toContain(QUERY_VALUE);
    expect(text).not.toContain(QUERY_VALUE_2);
  });

  it("shows non-secret headers with values and ignores secret headers", () => {
    const secretHeader: StoredHeader = {
      id: HEADER_ID,
      name: "X-Secret",
      secret: true,
    };
    const changes = changesOf(
      {
        headers: [
          { name: "Accept", value: "text/html", secret: false },
          secretHeader,
        ],
      },
      {
        ...base,
        headers: [
          { name: "Accept", value: "application/json", secret: false },
          { name: "X-Old", value: "1", secret: false },
        ],
      },
    );
    expect(changes).toEqual([
      {
        field: "header",
        key: "Accept",
        before: value("application/json"),
        after: value("text/html"),
      },
      { field: "header", key: "X-Old", before: value("1"), after: null },
    ]);
  });

  it("reports a body change as changed without type or content", () => {
    const changes = changesOf(
      { bodyType: "text", bodyContent: BODY_VALUE_2 },
      { ...base, bodyType: "json", bodyContent: BODY_VALUE },
    );
    expect(changes).toEqual([
      { field: "body", before: null, after: { kind: "changed" } },
    ]);
    expect(JSON.stringify(changes)).not.toContain(BODY_VALUE);
    expect(JSON.stringify(changes)).not.toContain(BODY_VALUE_2);
    expect(
      changesOf({ bodyType: "text", bodyContent: BODY_VALUE }),
    ).toHaveLength(1);
  });

  it("lists added and removed assertions by normalized text", () => {
    const changes = changesOf(
      {
        assertions: [
          { kind: "bodyContains", text: "ok" },
          {
            kind: "jsonPathEquals",
            path: "$['a'][0]",
            expected: '"1"',
            pathSegments: ["a", 0],
            expectedValue: "1",
          },
        ],
      },
      {
        ...base,
        assertions: [{ kind: "responseTimeBelow", ms: 500 }],
      },
    );
    expect(changes).toEqual([
      {
        field: "assertions",
        before: value("responseTimeBelow 500"),
        after: null,
      },
      { field: "assertions", before: null, after: value("bodyContains ok") },
      {
        field: "assertions",
        before: null,
        after: value('jsonPathEquals $.a[0] = "1"'),
      },
    ]);
  });

  it("treats equivalent JSONPath spellings as the same assertion", () => {
    const dotted = {
      kind: "jsonPathEquals" as const,
      path: "$.a",
      expected: "1",
      pathSegments: ["a"],
      expectedValue: 1,
    };
    expect(
      changesOf(
        { assertions: [{ ...dotted, path: "$['a']" }] },
        { ...base, assertions: [dotted] },
      ),
    ).toEqual([]);
  });

  it("names secret slots only: set, replace and remove", () => {
    const next: StoredConfig = {
      ...base,
      authType: "basic",
      headers: [{ id: HEADER_ID, name: "X-Secret", secret: true }],
    };
    const changes = monitorAuditChanges({ ...base, authType: "bearer" }, next, {
      written: ["auth.username", "auth.password", `header.${HEADER_ID}`],
      stored: new Set(["auth.token", "auth.password"]),
      deleted: ["auth.token"],
    });
    expect(changes.filter((change) => change.field === "secret")).toEqual([
      {
        field: "secret",
        key: "auth.username",
        before: null,
        after: { kind: "secret_set" },
      },
      {
        field: "secret",
        key: "auth.password",
        before: { kind: "secret_set" },
        after: { kind: "changed" },
      },
      {
        field: "secret",
        key: "X-Secret",
        before: null,
        after: { kind: "secret_set" },
      },
      {
        field: "secret",
        key: "auth.token",
        before: { kind: "secret_set" },
        after: null,
      },
    ]);
  });

  it("names a removed secret header by its previous name", () => {
    const changes = monitorAuditChanges(
      {
        ...base,
        headers: [{ id: HEADER_ID, name: "X-Gone", secret: true }],
      },
      base,
      { written: [], stored: new Set(), deleted: [`header.${HEADER_ID}`] },
    );
    expect(changes).toEqual([
      {
        field: "secret",
        key: "X-Gone",
        before: { kind: "secret_set" },
        after: null,
      },
    ]);
  });
});

describe("monitorAuditChanges when entries move without a per-item diff", () => {
  const changed = (field: string) => [
    { field, before: null, after: { kind: "changed" } },
  ];

  it("reports reordered headers, query parameters and assertions as changed", () => {
    const a = { name: "A", value: "1", secret: false };
    const b = { name: "B", value: "2", secret: false };
    expect(
      changesOf({ headers: [b, a] }, { ...base, headers: [a, b] }),
    ).toEqual(changed("header"));
    const qa = { name: "a", value: QUERY_VALUE };
    const qb = { name: "b", value: QUERY_VALUE_2 };
    const reorderedQuery = changesOf(
      { queryParams: [qb, qa] },
      { ...base, queryParams: [qa, qb] },
    );
    expect(reorderedQuery).toEqual(changed("queryParam"));
    expect(JSON.stringify(reorderedQuery)).not.toContain(QUERY_VALUE);
    const x = { kind: "bodyContains" as const, text: "x" };
    const y = { kind: "responseTimeBelow" as const, ms: 5 };
    expect(
      changesOf({ assertions: [y, x] }, { ...base, assertions: [x, y] }),
    ).toEqual(changed("assertions"));
  });

  it("reports a changed count of identical assertions", () => {
    const x = { kind: "bodyContains" as const, text: "x" };
    expect(
      changesOf({ assertions: [x] }, { ...base, assertions: [x, x] }),
    ).toEqual(changed("assertions"));
  });
});

describe("monitorAuditChanges with repeated names", () => {
  it("keys repeated query and header names by name#ordinal so no change is lost", () => {
    const changes = changesOf(
      {
        queryParams: [
          { name: "t", value: "1" },
          { name: "t", value: QUERY_VALUE_2 },
        ],
        headers: [
          { name: "X", value: "1", secret: false },
          { name: "X", value: "3", secret: false },
        ],
      },
      {
        ...base,
        queryParams: [
          { name: "t", value: "1" },
          { name: "t", value: QUERY_VALUE },
        ],
        headers: [
          { name: "X", value: "1", secret: false },
          { name: "X", value: "2", secret: false },
        ],
      },
    );
    expect(changes).toEqual([
      { field: "header", key: "X#1", before: value("2"), after: value("3") },
      {
        field: "queryParam",
        key: "t#1",
        before: { kind: "masked" },
        after: { kind: "masked" },
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain(QUERY_VALUE);
  });
});

describe("monitorAuditChanges for a renamed secret header", () => {
  it("shows the old and new names only, never a value", () => {
    const changes = changesOf(
      { headers: [{ id: HEADER_ID, name: "X-New", secret: true }] },
      {
        ...base,
        headers: [{ id: HEADER_ID, name: "X-Old", secret: true }],
      },
    );
    expect(changes).toEqual([
      { field: "header", before: value("X-Old"), after: value("X-New") },
    ]);
  });
});

describe("monitorAuditChanges secret header keys", () => {
  it("keys a secret header write by its name at write time, never the slot id", () => {
    const changes = monitorAuditChanges(
      {
        ...base,
        headers: [{ id: HEADER_ID, name: "X-Old", secret: true }],
      },
      {
        ...base,
        headers: [{ id: HEADER_ID, name: "X-New", secret: true }],
      },
      {
        written: [`header.${HEADER_ID}`],
        stored: new Set([`header.${HEADER_ID}`]),
        deleted: [],
      },
    );
    expect(changes).toEqual([
      { field: "header", before: value("X-Old"), after: value("X-New") },
      {
        field: "secret",
        key: "X-New",
        before: { kind: "secret_set" },
        after: { kind: "changed" },
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain(HEADER_ID);
  });
});

describe("monitorAuditChanges for a url that differs only in query values", () => {
  it("keeps the masked url before and says changed after", () => {
    const changes = changesOf(
      { url: `https://example.test/health?token=${QUERY_VALUE_2}` },
      { ...base, url: `https://example.test/health?token=${QUERY_VALUE}` },
    );
    expect(changes).toEqual([
      {
        field: "url",
        before: value("https://example.test/health?token=•••"),
        after: { kind: "changed" },
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain(QUERY_VALUE);
  });
});

describe("editAuditAction", () => {
  const written = (stored: string[]) => ({
    written: ["auth.token"],
    stored: new Set(stored),
    deleted: [],
  });
  it.each([
    ["config changed", true, written([]), "organization.monitor.update"],
    [
      "config changed with a replace",
      true,
      written(["auth.token"]),
      "organization.monitor.update",
    ],
    ["new slot only", false, written([]), "organization.monitor.secret.set"],
    [
      "replace only",
      false,
      written(["auth.token"]),
      "organization.monitor.secret.replace",
    ],
    [
      "only removals",
      false,
      { written: [], stored: new Set<string>(), deleted: ["x"] },
      "organization.monitor.update",
    ],
  ])("%s", (_name, configChanged, secrets, action) => {
    expect(editAuditAction(configChanged, secrets)).toBe(action);
  });

  it("uses replace when a new slot and a replaced slot are written together", () => {
    expect(
      editAuditAction(false, {
        written: ["auth.username", "auth.password"],
        stored: new Set(["auth.password"]),
        deleted: [],
      }),
    ).toBe("organization.monitor.secret.replace");
  });
});
