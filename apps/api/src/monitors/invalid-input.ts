import {
  MONITOR_INVALID_REASONS,
  type MonitorInvalidReason,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import type { ZodError } from "zod";

// Field names come from this allow-list of config paths, never from input.
const FIELD_PATTERN =
  /^(name|url|intervalSeconds|timeoutSeconds|method|expectedStatus|expectedVersion|clientRequestId|body(\.(type|content))?|auth(\.(type|headerName))?|headers(\.\d{1,6}(\.(id|name|value|secret))?)?|queryParams(\.\d{1,6}(\.(name|value))?)?|assertions(\.\d{1,6}(\.(kind|path|expected|text|ms))?)?)$/;

const REASONS: ReadonlySet<string> = new Set(MONITOR_INVALID_REASONS);
const MAX_REPORTED_FIELDS = 100;

type Issue = ZodError["issues"][number];

function reasonFor(issue: Issue): MonitorInvalidReason {
  switch (issue.code) {
    case "custom": {
      const reason = (issue.params as { reason?: unknown } | undefined)?.reason;
      return typeof reason === "string" && REASONS.has(reason)
        ? (reason as MonitorInvalidReason)
        : "invalid_format";
    }
    case "invalid_type":
      // Zod does not expose the input; a missing value is the only case that names "undefined".
      return issue.message.endsWith("received undefined")
        ? "required"
        : "invalid_format";
    case "too_small":
      return issue.origin === "string" ? "required" : "out_of_range";
    case "too_big":
      if (issue.origin === "string") return "too_long";
      return issue.origin === "array" ? "too_many" : "out_of_range";
    default:
      return "invalid_format";
  }
}

export function monitorInvalidFields(
  error: ZodError,
): { field: string; reason: MonitorInvalidReason }[] {
  const fields = new Map<string, MonitorInvalidReason>();
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const field = FIELD_PATTERN.test(path) ? path : "request";
    if (!fields.has(field)) fields.set(field, reasonFor(issue));
    if (fields.size >= MAX_REPORTED_FIELDS) break;
  }
  return [...fields].map(([field, reason]) => ({ field, reason }));
}

// Replaces the generic INVALID_INPUT for monitor routes. Body failures carry
// `{ field, reason }` only: no input echo and no Zod message (REQ-05). It runs
// before the handler, so it runs before authentication like the other routes.
export const monitorInvalidInputHook = (
  result:
    { success: true } | { success: false; error: ZodError; target: string },
): undefined => {
  if (result.success) return undefined;
  if (result.target !== "json") {
    throw new AppError(400, "INVALID_INPUT", "Invalid request input");
  }
  throw new AppError(400, "MONITOR_INVALID", "Invalid monitor input", {
    fields: monitorInvalidFields(result.error),
  });
};
