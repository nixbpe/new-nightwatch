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
import { planEntries } from "./secrets";
import { record } from "../form-test-support";

const NO_SECRETS = { base: null, get: () => "" };

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
    const errors = validateValues(valid(overrides), NO_SECRETS);
    expect(errors[field]).toBe(fieldMessage(field, reason));
  });

  it("accepts the defaults with a name and a URL", () => {
    expect(validateValues(valid(), NO_SECRETS)).toEqual({});
  });

  it("treats an empty or non-numeric timeout as out of the 1 to 30 range", () => {
    expect(
      validateValues(valid({ timeoutSeconds: "" }), NO_SECRETS).timeoutSeconds,
    ).toBe(fieldMessage("timeoutSeconds", "out_of_range"));
    expect(
      validateValues(valid({ timeoutSeconds: "abc" }), NO_SECRETS)
        .timeoutSeconds,
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

  it("places every error of a secret header row beside its own fields", () => {
    const values = valid({
      headers: [
        { ...emptyHeader(), name: "X-Key", secret: true },
        header("X-Team"),
      ],
    });
    const { placed, unplaced } = placeErrors(
      {
        "headers.0.name": "duplicate",
        "headers.0.value": "secret row",
        "headers.1.name": "plain row",
      },
      values,
    );
    expect(placed).toEqual({
      "headers.0.name": "duplicate",
      "headers.0.value": "secret row",
      "headers.1.name": "plain row",
    });
    expect(unplaced).toEqual([]);
  });

  it("places auth errors beside the auth fields and lists the rest in the summary", () => {
    const { placed, unplaced } = placeErrors(
      {
        url: "u",
        auth: "a",
        "auth.token": "t",
        "auth.headerName": "h",
        "secrets.0.value": "s",
        "headers.0.id": "i",
        request: "r",
      },
      valid({ headers: [{ ...emptyHeader(), name: "X-Key", secret: true }] }),
    );
    expect(Object.keys(placed)).toEqual([
      "url",
      "auth",
      "auth.token",
      "auth.headerName",
    ]);
    expect(unplaced).toHaveLength(3);
    expect(unplaced).toContain("header X-Key (แถวที่ 1): i");
  });

  it("places secrets.N errors at the input of the slot the entry named", () => {
    const sent = [
      { slot: "auth.token", path: "auth.token" },
      { slot: "header.x", path: "headers.1.value" },
    ];
    expect(
      serverFieldErrors(
        {
          fields: [
            { field: "secrets.1.value", reason: "crlf" },
            { field: "secrets.0", reason: "required" },
          ],
        },
        sent,
      ),
    ).toEqual({
      "headers.1.value": fieldMessage("secrets.1.value", "crlf"),
      "auth.token": fieldMessage("secrets.0", "required"),
    });
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

  it("keeps every stored slot the config still uses and sends the header as a secret without a value", () => {
    const values = valuesFromRecord(stored);
    const base = editBaseFromRecord(stored);
    const entries = planEntries(values, base, () => "");
    const body = editPayload(values, base, entries);
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
    expect(testEditPayload(values, entries)).not.toHaveProperty(
      "expectedVersion",
    );
    expect(validateValues(values, { base, get: () => "" })).toEqual({});
  });

  it("never sends a client request id on Edit or a version on Create", () => {
    const values = valid();
    expect(
      editPayload(values, editBaseFromRecord(stored), []),
    ).not.toHaveProperty("clientRequestId");
    expect(
      createPayload(values, "c9f0f895-fb98-4a0e-8b3a-7d3c6f1a2b4d", []),
    ).not.toHaveProperty("expectedVersion");
  });

  // Path/query, scheme, port and host origin-change cases are covered by
  // form/secrets.test.tsx's "treats %s as %s" it.each; the no-secrets-at-all
  // case is covered by MonitorFormSecrets.test.tsx's "does not block an
  // origin change on a monitor without secrets".

  it("counts advanced settings that are not at their default", () => {
    expect(advancedCount(defaultValues())).toBe(0);
    expect(advancedCount(valuesFromRecord(stored))).toBe(1 + 2);
    expect(configInput(valid()).body).toBeNull();
  });
});

describe("secret entries", () => {
  const bearer = valid({ auth: { type: "bearer" } });
  const errorsFor = (value: string, values = bearer) =>
    validateValues(values, { base: null, get: () => value });

  it("requires a value for every required slot on Create", () => {
    expect(errorsFor("")["auth.token"]).toBeDefined();
    expect(errorsFor("token")).toEqual({});
  });

  it("applies the contract limits to a secret value at its own field", () => {
    expect(errorsFor("a\nb")["auth.token"]).toBe(
      fieldMessage("secrets.0.value", "crlf"),
    );
    expect(errorsFor("a\0b")["auth.token"]).toBe(
      fieldMessage("secrets.0.value", "invalid_format"),
    );
    expect(errorsFor("x".repeat(4097))["auth.token"]).toBe(
      fieldMessage("secrets.0.value", "too_long"),
    );
  });

  it("places an empty secret header value at that row", () => {
    const secretHeader = {
      ...emptyHeader(),
      id: "0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
      name: "X-Key",
      secret: true,
    };
    expect(
      errorsFor("", valid({ headers: [header("X-A"), secretHeader] }))[
        "headers.1.value"
      ],
    ).toBeDefined();
  });

  it("plans a keep or replace per required slot and a delete only for stored slots no longer required", () => {
    const stored = record({
      auth: { type: "bearer" },
      secretSlots: [
        { slot: "auth.token", configured: true },
        {
          slot: "header.0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
          configured: true,
        },
      ],
    });
    const base = editBaseFromRecord(stored);
    const values = valuesFromRecord(stored);
    expect(
      planEntries(values, base, () => "").map((e) => [e.slot, e.action]),
    ).toEqual([
      ["auth.token", "keep"],
      ["header.0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", "delete"],
    ]);
    expect(
      planEntries(
        { ...values, replacing: ["auth.token"] },
        base,
        () => "new",
      ).map((e) => [e.slot, e.action]),
    ).toEqual([
      ["auth.token", "replace"],
      ["header.0f6a4b7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", "delete"],
    ]);
  });

  it("does not report an origin change once every kept slot is replaced", () => {
    const stored = record({
      auth: { type: "bearer" },
      secretSlots: [{ slot: "auth.token", configured: true }],
    });
    const base = editBaseFromRecord(stored);
    const moved = { ...valuesFromRecord(stored), url: "https://other.example" };
    expect(secretOriginChanged(base, moved)).toBe(true);
    expect(
      secretOriginChanged(base, { ...moved, replacing: ["auth.token"] }),
    ).toBe(false);
    expect(
      secretOriginChanged(base, { ...moved, auth: { type: "none" } }),
    ).toBe(false);
  });
});
