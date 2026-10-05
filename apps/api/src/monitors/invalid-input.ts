import {
  monitorIssueReason,
  type MonitorInvalidReason,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import type { ZodError } from "zod";

// Field names come from this allow-list of config paths, never from input.
const FIELD_PATTERN =
  /^(name|url|intervalSeconds|timeoutSeconds|method|expectedStatus|expectedVersion|clientRequestId|body(\.(type|content))?|auth(\.(type|headerName))?|headers(\.\d{1,6}(\.(id|name|value|secret))?)?|queryParams(\.\d{1,6}(\.(name|value))?)?|assertions(\.\d{1,6}(\.(kind|path|expected|text|ms))?)?|secrets(\.\d{1,6}(\.(slot|action|value))?)?|alerts(\.(failureThreshold|downEnabled|sslEnabled|sslCautionDays))?)$/;

const MAX_REPORTED_FIELDS = 100;

export function monitorInvalidFields(
  error: ZodError,
): { field: string; reason: MonitorInvalidReason }[] {
  const fields = new Map<string, MonitorInvalidReason>();
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const field = FIELD_PATTERN.test(path) ? path : "request";
    if (!fields.has(field)) fields.set(field, monitorIssueReason(issue));
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
