import type { MonitorInvalidReason } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import {
  advancedCount,
  configInput,
  createPayload,
  defaultValues,
  editBaseFromRecord,
  editPayload,
  emptyAssertion,
  emptyHeader,
  fieldMessage,
  placeErrors,
  secretOriginChanged,
  serverFieldErrors,
  testEditPayload,
  validateValues,
  valuesFromRecord,
  type FormValues,
} from "./model";
import { record } from "../form-test-support";

function valid(overrides: Partial<FormValues> = {}): FormValues {
  return {
    ...defaultValues(),
    name: "Payments API",
    url: "https://api.acme.example/health",
    ...overrides,
  };
}

const header = (name: string, value = "v") => ({
  ...emptyHeader(),
  name,
  value,
});

describe("client validation mirrors the server's field paths and reasons", () => {
  const cases: [MonitorInvalidReason, string, Partial<FormValues>][] = [
    ["required", "name", { name: "" }],
    ["too_long", "name", { name: "x".repeat(101) }],
    ["invalid_format", "url", { url: "not a url" }],
    ["blocked_scheme", "url", { url: "ftp://example.com" }],
    ["embedded_credentials", "url", { url: "https://u:p@example.com" }],
    ["blocked_port", "url", { url: "https://example.com:22" }],
    ["blocked_header", "headers.0.name", { headers: [header("Host")] }],
    [
      "duplicate",
      "headers.1.name",
      { headers: [header("X-A"), header("x-a")] },
    ],
    ["crlf", "headers.0.value", { headers: [header("X-A", "a\nb")] }],
    [
      "auth_header_conflict",
      "headers.0.name",
      { headers: [header("Authorization")], auth: { type: "bearer" } },
    ],
    ["invalid_json", "body.content", { bodyContent: "{nope" }],
    [
      "invalid_jsonpath",
      "assertions.0.path",
      {
        assertions: [
          { ...emptyAssertion("jsonPathEquals"), path: "$..a", expected: "1" },
        ],
      },
    ],
    [
      "body_assertion_with_head",
      "assertions.0.kind",
      {
        method: "HEAD",
        assertions: [{ ...emptyAssertion("bodyContains"), text: "ok" }],
      },
    ],
    ["out_of_range", "timeoutSeconds", { timeoutSeconds: "31" }],
    [
      "too_many",
      "headers",
      {
        headers: Array.from({ length: 21 }, (_, index) =>
          header(`X-${String(index)}`),
        ),
      },
    ],
  ];

  it.each(cases)("reports %s at %s", (reason, field, overrides) => {
    const errors = validateValues(valid(overrides));
    expect(errors[field]).toBe(fieldMessage(field, reason));
  });

  it("accepts the defaults with a name and a URL", () => {
    expect(validateValues(valid())).toEqual({});
  });

  it("treats an empty or non-numeric timeout as out of the 1 to 30 range", () => {
    expect(validateValues(valid({ timeoutSeconds: "" })).timeoutSeconds).toBe(
      fieldMessage("timeoutSeconds", "out_of_range"),
    );
    expect(
      validateValues(valid({ timeoutSeconds: "abc" })).timeoutSeconds,
    ).toBe(fieldMessage("timeoutSeconds", "out_of_range"));
  });
});

describe("server errors", () => {
  it("places MONITOR_INVALID fields with the same messages and rejects anything else", () => {
    expect(
      serverFieldErrors({
        fields: [
          { field: "headers.2.name", reason: "duplicate" },
          { field: "queryParams.0.value", reason: "too_long" },
        ],
      }),
    ).toEqual({
      "headers.2.name": fieldMessage("headers.2.name", "duplicate"),
      "queryParams.0.value": fieldMessage("queryParams.0.value", "too_long"),
    });
    expect(
      serverFieldErrors({ fields: [{ field: "x", reason: "nope" }] }),
    ).toBeNull();
    expect(serverFieldErrors(undefined)).toBeNull();
  });

  it("treats every error of a secret header row as unplaced, its name included", () => {
    const values = valid({
      headers: [
        { ...emptyHeader(), name: "X-Key", secret: true },
        header("X-Team"),
      ],
    });
    const { placed, unplaced } = placeErrors(
      { "headers.0.name": "duplicate", "headers.1.name": "plain row" },
      values,
    );
    expect(placed).toEqual({ "headers.1.name": "plain row" });
    expect(unplaced).toEqual(["header ลับ X-Key (แถวที่ 1): duplicate"]);
  });

  it("puts errors without a control in the summary, including a secret header's value", () => {
    const values = valid({
      headers: [{ ...emptyHeader(), name: "X-Key", secret: true }],
    });
    const { placed, unplaced } = placeErrors(
      {
        url: "u",
        "headers.0.value": "secret row",
        auth: "a",
        "secrets.0.value": "s",
        request: "r",
      },
      values,
    );
    expect(Object.keys(placed)).toEqual(["url"]);
    expect(unplaced).toHaveLength(4);
    expect(unplaced).toContain("header ลับ X-Key (แถวที่ 1): secret row");
  });
});

describe("Edit payloads", () => {
  const stored = record({
    version: 7,
    auth: { type: "apiKey", headerName: "X-Api-Key" },
    headers: [
      {
        id: "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
        name: "X-Token",
        secret: true,
      },
      { name: "X-Team", value: "core", secret: false },
    ],
    secretSlots: [
      { slot: "auth.apiKey", configured: true },
      { slot: "header.0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", configured: true },
    ],
  });

  it("passes auth and secret headers through and keeps every stored slot", () => {
    const values = valuesFromRecord(stored);
    const base = editBaseFromRecord(stored);
    const body = editPayload(values, base);
    expect(body.expectedVersion).toBe(7);
    expect(body.auth).toEqual({ type: "apiKey", headerName: "X-Api-Key" });
    expect(body.headers).toEqual([
      {
        id: "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
        name: "X-Token",
        secret: true,
      },
      { name: "X-Team", value: "core", secret: false },
    ]);
    expect(body.secrets).toEqual([
      { slot: "auth.apiKey", action: "keep" },
      { slot: "header.0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", action: "keep" },
    ]);
    expect(testEditPayload(values, base)).not.toHaveProperty("expectedVersion");
    expect(validateValues(values)).toEqual({});
  });

  it("never sends a client request id on Edit or a version on Create", () => {
    const values = valid();
    expect(editPayload(values, editBaseFromRecord(stored))).not.toHaveProperty(
      "clientRequestId",
    );
    expect(
      createPayload(values, "c9f0f895-fb98-4a0e-8b3a-7d3c6f1a2b4d"),
    ).not.toHaveProperty("expectedVersion");
  });

  it("detects an origin change only when a secret slot is kept", () => {
    const values = valuesFromRecord(stored);
    const base = editBaseFromRecord(stored);
    expect(secretOriginChanged(base, values)).toBe(false);
    expect(
      secretOriginChanged(base, {
        ...values,
        url: "https://api.acme.example/other?x=1",
      }),
    ).toBe(false);
    expect(
      secretOriginChanged(base, {
        ...values,
        url: "http://api.acme.example/health",
      }),
    ).toBe(true);
    expect(
      secretOriginChanged(base, {
        ...values,
        url: "https://api.acme.example:8443/health",
      }),
    ).toBe(true);
    expect(
      secretOriginChanged(base, {
        ...values,
        url: "https://other.example/health",
      }),
    ).toBe(true);
    const plain = record();
    expect(
      secretOriginChanged(editBaseFromRecord(plain), {
        ...valuesFromRecord(plain),
        url: "https://other.example",
      }),
    ).toBe(false);
  });

  it("counts advanced settings that are not at their default", () => {
    expect(advancedCount(defaultValues())).toBe(0);
    expect(advancedCount(valuesFromRecord(stored))).toBe(1 + 2);
    expect(configInput(valid()).body).toBeNull();
  });
});
