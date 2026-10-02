import { describe, expect, it } from "vitest";

import { diffConfig } from "./config-changes";
import type { StoredConfig } from "./record";
import type { SecretPlan } from "./secrets";

const base: StoredConfig = {
  name: "Monitor",
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
  expectedStatusText: "200",
  expectedStatusRanges: [{ from: 200, to: 200 }],
  assertions: [],
};
const noSecrets: SecretPlan = { writes: [], keeps: [], deletes: [] };
const diff = (
  next: Partial<StoredConfig>,
  plan: SecretPlan = noSecrets,
  stored: string[] = [],
  previous: StoredConfig = base,
) => diffConfig(previous, { ...previous, ...next }, plan, new Set(stored));

describe("diffConfig", () => {
  it("lists nothing when nothing changed", () => {
    expect(diff({})).toEqual([]);
  });

  it("records before and after for plain value fields", () => {
    expect(
      diff({
        name: "Renamed",
        method: "POST",
        expectedStatusText: "2xx",
        intervalSeconds: 60,
        timeoutSeconds: 5,
        authType: "apiKey",
        apiKeyHeaderName: "X-Key",
      }),
    ).toEqual([
      { field: "name", kind: "value", before: "Monitor", after: "Renamed" },
      { field: "method", kind: "value", before: "GET", after: "POST" },
      {
        field: "expectedStatus",
        kind: "value",
        before: "200",
        after: "2xx",
      },
      { field: "auth.type", kind: "value", before: "none", after: "apiKey" },
      {
        field: "auth.headerName",
        kind: "value",
        before: null,
        after: "X-Key",
      },
      { field: "intervalSeconds", kind: "value", before: 300, after: 60 },
      { field: "timeoutSeconds", kind: "value", before: 10, after: 5 },
    ]);
  });

  it("masks query values inside the url and reports a masked-only change as changed", () => {
    expect(diff({ url: "https://example.test/other?token=abc" })).toEqual([
      {
        field: "url",
        kind: "value",
        before: "https://example.test/health",
        after: "https://example.test/other?token=•••",
      },
    ]);
    const marker = diff(
      { url: "https://example.test/health?token=two" },
      noSecrets,
      [],
      { ...base, url: "https://example.test/health?token=one" },
    );
    expect(marker).toEqual([{ field: "url", kind: "changed" }]);
    expect(JSON.stringify(marker)).not.toContain("one");
  });

  it("shows a non-secret header value and null for an absent header", () => {
    expect(
      diff(
        {
          headers: [
            { name: "X-Old", value: "b", secret: false },
            { name: "X-Added", value: "n", secret: false },
          ],
        },
        noSecrets,
        [],
        {
          ...base,
          headers: [
            { name: "x-old", value: "a", secret: false },
            { name: "X-Gone", value: "g", secret: false },
          ],
        },
      ),
    ).toEqual([
      { field: "headers.X-Old", kind: "value", before: "a", after: "b" },
      { field: "headers.X-Added", kind: "value", before: null, after: "n" },
      { field: "headers.X-Gone", kind: "value", before: "g", after: null },
    ]);
  });

  it("never carries the value of a header whose secret label changed", () => {
    const toSecret = diff(
      { headers: [{ id: "h1", name: "X-Token", secret: true }] },
      {
        writes: [{ slot: "header.h1", value: "new-secret" }],
        keeps: [],
        deletes: [],
      },
      [],
      {
        ...base,
        headers: [{ name: "X-Token", value: "plain-before", secret: false }],
      },
    );
    expect(toSecret).toContainEqual({
      field: "headers.X-Token",
      kind: "secret",
      action: "set",
    });
    expect(JSON.stringify(toSecret)).not.toContain("plain-before");
    expect(JSON.stringify(toSecret)).not.toContain("new-secret");

    const toPlain = diff(
      { headers: [{ name: "X-Token", value: "plain-after", secret: false }] },
      { writes: [], keeps: [], deletes: ["header.h1"] },
      ["header.h1"],
      { ...base, headers: [{ id: "h1", name: "X-Token", secret: true }] },
    );
    expect(toPlain).toContainEqual({
      field: "headers.X-Token",
      kind: "secret",
      action: "deleted",
    });
    expect(JSON.stringify(toPlain)).not.toContain("plain-after");
  });

  it("reports a renamed header like a plain rename, and a kept secret slot as no secret action", () => {
    const keep = diff(
      { headers: [{ id: "h1", name: "X-B", secret: true }] },
      noSecrets,
      ["header.h1"],
      { ...base, headers: [{ id: "h1", name: "X-A", secret: true }] },
    );
    expect(keep).toEqual([
      { field: "headers.X-A", kind: "changed" },
      { field: "headers.X-B", kind: "changed" },
    ]);

    const replaced = diff(
      { headers: [{ id: "h1", name: "X-B", secret: true }] },
      { writes: [{ slot: "header.h1", value: "v" }], keeps: [], deletes: [] },
      ["header.h1"],
      { ...base, headers: [{ id: "h1", name: "X-A", secret: true }] },
    );
    expect(replaced).toContainEqual({
      field: "header.h1",
      kind: "secret",
      action: "replaced",
    });
    expect(
      replaced.some(
        (c) => c.kind === "secret" && c.field.startsWith("headers."),
      ),
    ).toBe(false);

    const plain = diff(
      { headers: [{ name: "X-B", value: "v", secret: false }] },
      noSecrets,
      [],
      { ...base, headers: [{ name: "X-A", value: "v", secret: false }] },
    );
    expect(plain).toEqual([
      { field: "headers.X-B", kind: "value", before: null, after: "v" },
      { field: "headers.X-A", kind: "value", before: "v", after: null },
    ]);
  });

  it("masks query param values and reports only add, remove and rename", () => {
    expect(
      diff(
        {
          queryParams: [
            { name: "b", value: "2" },
            { name: "c", value: "x" },
          ],
        },
        noSecrets,
        [],
        {
          ...base,
          queryParams: [
            { name: "a", value: "1" },
            { name: "c", value: "y" },
          ],
        },
      ),
    ).toEqual([
      { field: "queryParams.a", kind: "value", before: "•••", after: null },
      { field: "queryParams.c", kind: "value", before: "•••", after: "•••" },
      { field: "queryParams.b", kind: "value", before: null, after: "•••" },
    ]);
  });

  it("reports body and assertions as changed without values", () => {
    const changes = diff({
      bodyType: "json",
      bodyContent: '{"password":"hunter2"}',
      assertions: [{ kind: "bodyContains", text: "needle-text" }],
    });
    expect(changes).toEqual([
      { field: "body", kind: "changed" },
      { field: "assertions", kind: "changed" },
    ]);
  });

  it("reports secret slots as set, replaced or deleted without values", () => {
    const changes = diff(
      {},
      {
        writes: [
          { slot: "auth.token", value: "tok-secret" },
          { slot: "auth.password", value: "pw-secret" },
        ],
        keeps: [],
        deletes: ["header.h9"],
      },
      ["auth.password", "header.h9"],
    );
    expect(changes).toEqual([
      { field: "auth.token", kind: "secret", action: "set" },
      { field: "auth.password", kind: "secret", action: "replaced" },
      { field: "header.h9", kind: "secret", action: "deleted" },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/tok-secret|pw-secret/);
  });

  it("cuts a long value at 200 characters without splitting a code point", () => {
    const long = "😀".repeat(250);
    const [change] = diff({ name: long });
    expect(change).toMatchObject({ kind: "value" });
    const after = (change as { after: string }).after;
    expect(Array.from(after)).toHaveLength(200);
    expect(() => JSON.stringify(after)).not.toThrow();
  });
});
