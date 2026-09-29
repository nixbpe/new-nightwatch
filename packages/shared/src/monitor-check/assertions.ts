import { findAll } from "./json-scan";
import { truncateActual } from "./redact";
import type {
  AssertionReason,
  AssertionResult,
  JsonScalar,
  NormalizedAssertion,
} from "./types";

export interface EvaluatedResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  bodyTruncated: boolean;
  elapsedMs: number;
}

type Decoded = { ok: true; text: string } | { ok: false };

function charsetOf(contentType: string | undefined): string {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  return match?.[1]?.toLowerCase() ?? "utf-8";
}

/** Supports utf-8, us-ascii and iso-8859-1 (aliases utf8, ascii, latin1); a cut multi-byte tail of a truncated body is not an error. */
function decodeBody(response: EvaluatedResponse): Decoded {
  switch (charsetOf(response.headers["content-type"])) {
    case "utf-8":
    case "utf8":
      try {
        return {
          ok: true,
          text: new TextDecoder("utf-8", { fatal: true }).decode(
            response.body,
            { stream: response.bodyTruncated },
          ),
        };
      } catch {
        return { ok: false };
      }
    case "us-ascii":
    case "ascii":
      return response.body.every((byte) => byte < 0x80)
        ? { ok: true, text: response.body.toString("latin1") }
        : { ok: false };
    case "iso-8859-1":
    case "latin1":
      return { ok: true, text: response.body.toString("latin1") };
    default:
      return { ok: false };
  }
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/** JSON text of a value, so the string "1" and the number 1 read differently. */
function display(value: unknown): string {
  return JSON.stringify(value);
}

export function evaluateAssertions(
  assertions: readonly NormalizedAssertion[],
  response: EvaluatedResponse | null,
  redact: (text: string) => string,
): { results: AssertionResult[]; evaluatedFromPrefix: boolean } {
  let decoded: Decoded | undefined;
  // One validity parse per response, shared by every JSONPath assertion.
  let valid: boolean | undefined;
  const text = (from: EvaluatedResponse): Decoded =>
    (decoded ??= decodeBody(from));

  const shown = (value: string) => {
    const cut = truncateActual(redact(value));
    return { actual: cut.text, actualTruncated: cut.truncated };
  };

  const evaluateOne = (assertion: NormalizedAssertion): AssertionResult => {
    const base = {
      actual: null,
      actualType: null,
      actualTruncated: false,
    };
    const expected =
      assertion.kind === "jsonPathEquals"
        ? display(assertion.expectedValue)
        : assertion.kind === "bodyContains"
          ? assertion.text
          : String(assertion.ms);
    const outcome = (
      status: AssertionResult["status"],
      reason: AssertionReason | null,
      extra: Partial<AssertionResult> = {},
    ): AssertionResult => ({
      kind: assertion.kind,
      expected,
      ...base,
      status,
      reason,
      ...extra,
    });

    if (response === null) return outcome("not_evaluated", "no_response");

    if (assertion.kind === "responseTimeBelow") {
      const passed = response.elapsedMs < assertion.ms;
      return outcome(passed ? "pass" : "fail", passed ? null : "too_slow", {
        actual: String(response.elapsedMs),
      });
    }

    if (response.body.length === 0) return outcome("fail", "no_body");
    const body = text(response);
    if (!body.ok) return outcome("fail", "undecodable");

    if (assertion.kind === "bodyContains") {
      return body.text.includes(assertion.text)
        ? outcome("pass", null)
        : outcome("fail", "text_not_found");
    }

    valid ??= isJson(body.text);
    if (!valid) return outcome("fail", "not_json");
    const matches = findAll(body.text, assertion.pathSegments);
    if (matches.length === 0) return outcome("fail", "path_not_found");
    if (matches.length > 1) return outcome("fail", "multiple_matches");
    const found = matches[0];
    const foundType = jsonType(found);
    const details = { actualType: foundType, ...shown(display(found)) };
    const expectedValue: JsonScalar = assertion.expectedValue;
    if (foundType !== jsonType(expectedValue)) {
      return outcome("fail", "type_mismatch", details);
    }
    return found === expectedValue
      ? outcome("pass", null, details)
      : outcome("fail", "value_mismatch", details);
  };

  return {
    results: assertions.map(evaluateOne),
    evaluatedFromPrefix:
      response !== null &&
      response.bodyTruncated &&
      assertions.some((assertion) => assertion.kind !== "responseTimeBelow"),
  };
}
