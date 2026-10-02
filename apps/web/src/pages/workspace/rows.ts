import type { MonitorListResponse } from "@nightwatch/api-contract";

import { ApiError } from "../../lib/api/client";

export type MonitorRow = MonitorListResponse["monitors"][number];

const SSL_WARNING_LEVELS = new Set(["caution", "danger", "expired"]);

export function hasSslWarning(row: MonitorRow): boolean {
  return SSL_WARNING_LEVELS.has(row.ssl.level);
}

// A 403 means the membership or role changed: cached rows of that organization must not stay on screen.
export function isDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}
