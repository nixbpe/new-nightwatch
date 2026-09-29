import {
  normalizeMonitorConfig,
  type MonitorConfig,
  type MonitorRecord,
  type StatusRange,
  type StoredAssertion,
  type StoredHeader,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";

export const MONITOR_COLUMNS = `id, name, url, method, headers,
  query_params as "queryParams", body_type as "bodyType",
  body_content as "bodyContent", auth_type as "authType",
  api_key_header_name as "apiKeyHeaderName",
  expected_status_text as "expectedStatusText",
  expected_status_ranges as "expectedStatusRanges", assertions,
  interval_seconds as "intervalSeconds", timeout_seconds as "timeoutSeconds",
  status, version, last_check_at as "lastCheckAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

export type MonitorRow = {
  id: string;
  name: string;
  url: string;
  method: MonitorConfig["method"];
  headers: StoredHeader[];
  queryParams: { name: string; value: string }[];
  bodyType: "json" | "text" | null;
  bodyContent: string | null;
  authType: "none" | "bearer" | "basic" | "apiKey";
  apiKeyHeaderName: string | null;
  expectedStatusText: string;
  expectedStatusRanges: StatusRange[];
  assertions: StoredAssertion[];
  intervalSeconds: number;
  timeoutSeconds: number;
  status: "active" | "paused";
  version: number;
  lastCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The columns Create and Edit write, in the forms the database stores. */
export type StoredConfig = {
  name: string;
  url: string;
  method: MonitorConfig["method"];
  intervalSeconds: number;
  timeoutSeconds: number;
  headers: StoredHeader[];
  queryParams: { name: string; value: string }[];
  bodyType: "json" | "text" | null;
  bodyContent: string | null;
  authType: MonitorRow["authType"];
  apiKeyHeaderName: string | null;
  expectedStatusText: string;
  expectedStatusRanges: StatusRange[];
  assertions: StoredAssertion[];
};

/**
 * Gives every secret header an id (its future slot name). A header sent
 * without one reuses the id of the stored header with the same name, so an edit
 * that omits ids is not read as deleting and re-adding the header.
 */
export function assignHeaderIds(
  headers: StoredHeader[],
  stored: StoredHeader[],
): StoredHeader[] {
  const used = new Set(
    headers.flatMap((header) =>
      header.id === undefined ? [] : [header.id.toLowerCase()],
    ),
  );
  return headers.map((header, index) => {
    if (!header.secret || header.id !== undefined) return header;
    const match = stored.find(
      (candidate) =>
        candidate.secret &&
        candidate.id !== undefined &&
        candidate.name.toLowerCase() === header.name.toLowerCase(),
    );
    // The stored id belongs to a header this request keeps under another name.
    if (match?.id !== undefined && used.has(match.id.toLowerCase())) {
      throw new AppError(400, "MONITOR_INVALID", "Invalid monitor input", {
        fields: [{ field: `headers.${String(index)}.id`, reason: "duplicate" }],
      });
    }
    const id = match?.id ?? crypto.randomUUID();
    used.add(id.toLowerCase());
    return { ...header, id };
  });
}

// Secrets never enter the `headers` column: a secret header keeps its name and
// slot id only, whatever value the client sent.
function storedHeader(header: MonitorConfig["headers"][number]): StoredHeader {
  if (header.secret) {
    return {
      ...(header.id === undefined ? {} : { id: header.id }),
      name: header.name,
      secret: true,
    };
  }
  return { name: header.name, value: header.value ?? "", secret: false };
}

export function toStoredConfig(config: MonitorConfig): StoredConfig {
  const normalized = normalizeMonitorConfig(config);
  return {
    name: config.name,
    url: config.url,
    method: config.method,
    intervalSeconds: config.intervalSeconds,
    timeoutSeconds: config.timeoutSeconds,
    headers: config.headers.map(storedHeader),
    queryParams: config.queryParams,
    bodyType: config.body?.type ?? null,
    bodyContent: config.body?.content ?? null,
    authType: config.auth.type,
    apiKeyHeaderName:
      config.auth.type === "apiKey" ? config.auth.headerName : null,
    expectedStatusText: normalized.expectedStatusText,
    expectedStatusRanges: normalized.expectedStatusRanges,
    assertions: normalized.assertions,
  };
}

export function storedFromRow(row: MonitorRow): StoredConfig {
  return {
    name: row.name,
    url: row.url,
    method: row.method,
    intervalSeconds: row.intervalSeconds,
    timeoutSeconds: row.timeoutSeconds,
    headers: row.headers,
    queryParams: row.queryParams,
    bodyType: row.bodyType,
    bodyContent: row.bodyContent,
    authType: row.authType,
    apiKeyHeaderName: row.apiKeyHeaderName,
    expectedStatusText: row.expectedStatusText,
    expectedStatusRanges: row.expectedStatusRanges,
    assertions: row.assertions,
  };
}

// jsonb does not keep key order, so equality needs a key-sorted form.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameConfig(left: StoredConfig, right: StoredConfig): boolean {
  return canonical(left) === canonical(right);
}

// AC-40: only these fields change what a check sends or how it is judged.
// Assertions compare their normalized form, so `$.a` and `$['a']` are the same.
export function affectsChecks(
  previous: StoredConfig,
  next: StoredConfig,
): boolean {
  const view = (config: StoredConfig): string =>
    canonical([
      config.url,
      config.method,
      config.headers,
      config.queryParams,
      config.bodyType,
      config.bodyContent,
      config.authType,
      config.apiKeyHeaderName,
      config.expectedStatusRanges,
      config.timeoutSeconds,
      config.assertions.map((assertion) =>
        assertion.kind === "jsonPathEquals"
          ? {
              kind: assertion.kind,
              pathSegments: assertion.pathSegments,
              expectedValue: assertion.expectedValue,
            }
          : assertion,
      ),
    ]);
  return view(previous) !== view(next);
}

export function toRecord(
  row: MonitorRow,
  secretSlots: string[],
): MonitorRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    intervalSeconds: row.intervalSeconds,
    timeoutSeconds: row.timeoutSeconds,
    headers: row.headers.map((header) => ({
      ...(header.id === undefined ? {} : { id: header.id }),
      name: header.name,
      ...(header.value === undefined ? {} : { value: header.value }),
      secret: header.secret,
    })),
    queryParams: row.queryParams,
    body:
      row.bodyType === null
        ? null
        : { type: row.bodyType, content: row.bodyContent ?? "" },
    expectedStatus: row.expectedStatusText,
    assertions: row.assertions.map((assertion) =>
      assertion.kind === "jsonPathEquals"
        ? {
            kind: assertion.kind,
            path: assertion.path,
            expected: assertion.expected,
          }
        : assertion,
    ),
    auth:
      row.authType === "apiKey"
        ? { type: "apiKey", headerName: row.apiKeyHeaderName ?? "" }
        : { type: row.authType },
    secretSlots: secretSlots.map((slot) => ({ slot, configured: true })),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
