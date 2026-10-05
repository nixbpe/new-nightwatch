import {
  monitorConfigSchema,
  monitorCreateSchema,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { monitorInvalidInputHook } from "./invalid-input";

function fieldsOf(input: unknown, schema = monitorConfigSchema) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected a validation failure");
  try {
    monitorInvalidInputHook({
      success: false,
      error: result.error,
      target: "json",
    });
  } catch (error) {
    if (error instanceof AppError) {
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("MONITOR_INVALID");
      return (error.details as { fields: unknown[] }).fields;
    }
    throw error;
  }
  throw new Error("hook did not throw");
}

describe("monitorInvalidInputHook", () => {
  it("maps rule failures to field and reason without echoing input", () => {
    const secretLooking = "sk_live_should_never_be_echoed";
    const fields = fieldsOf({
      name: "a",
      url: `ftp://user:${secretLooking}@example.com/`,
      intervalSeconds: 7,
      headers: [
        { name: "Host", value: "x", secret: false },
        { name: "X-A", value: "a\r\nb", secret: false },
      ],
    });
    expect(fields).toEqual([
      { field: "url", reason: "blocked_scheme" },
      { field: "intervalSeconds", reason: "out_of_range" },
      { field: "headers.0.name", reason: "blocked_header" },
      { field: "headers.1.value", reason: "crlf" },
    ]);
    expect(JSON.stringify(fields)).not.toContain(secretLooking);
  });

  it("maps structural failures, and stops before rule checks", () => {
    expect(
      fieldsOf({
        name: "",
        url: "ftp://example.com/",
        timeoutSeconds: 31,
        headers: [{ name: "X-A", value: "a".repeat(4097), secret: false }],
        assertions: [{ kind: "nope" }],
      }),
    ).toEqual([
      { field: "name", reason: "required" },
      { field: "timeoutSeconds", reason: "out_of_range" },
      { field: "headers.0.value", reason: "too_long" },
      { field: "assertions.0.kind", reason: "invalid_format" },
    ]);
  });

  it("reports missing and mistyped fields as required and invalid_format", () => {
    expect(fieldsOf({ url: 5 })).toEqual([
      { field: "name", reason: "required" },
      { field: "url", reason: "invalid_format" },
    ]);
  });

  it("reports alerts fields by their own path, not the generic request field (issue #60)", () => {
    expect(
      fieldsOf({
        name: "a",
        url: "https://example.com/",
        alerts: { failureThreshold: 0, sslCautionDays: "x" },
      }),
    ).toEqual([
      { field: "alerts.failureThreshold", reason: "out_of_range" },
      { field: "alerts.sslCautionDays", reason: "invalid_format" },
    ]);
  });

  it("reports the clientRequestId of Create", () => {
    expect(
      fieldsOf(
        { name: "a", url: "https://example.com/", clientRequestId: "nope" },
        monitorCreateSchema,
      ),
    ).toEqual([{ field: "clientRequestId", reason: "invalid_format" }]);
  });

  it("reports too many rows and falls back to a generic field for unknown paths", () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      name: `x-${String(index)}`,
      value: "v",
    }));
    expect(
      fieldsOf({ name: "a", url: "https://example.com/", headers: rows }),
    ).toEqual([{ field: "headers", reason: "too_many" }]);
    expect(fieldsOf("not an object")).toEqual([
      { field: "request", reason: "invalid_format" },
    ]);
  });

  it("keeps generic INVALID_INPUT for non-body failures", () => {
    const result = monitorConfigSchema.safeParse(null);
    if (result.success) throw new Error("expected failure");
    expect(() => {
      monitorInvalidInputHook({
        success: false,
        error: result.error,
        target: "param",
      });
    }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
