import { z } from "zod";

// Browser-safe on purpose (PKG-01): depends on zod only. The web app imports
// this file for form validation; apps/api parses requests with it and stores
// the normalized forms, so the Worker never parses user text. The API tests
// compare the lists below with packages/shared.

// ---- Limits (spec: Design decisions, OD-20) --------------------------------

export const MONITOR_LIMIT_PER_ORGANIZATION = 50;
export const MONITOR_NAME_MAX_LENGTH = 100;
export const MONITOR_URL_MAX_LENGTH = 2048;
export const MONITOR_MAX_HEADERS = 20;
export const MONITOR_MAX_QUERY_PARAMS = 20;
export const MONITOR_ROW_NAME_MAX_LENGTH = 256;
export const MONITOR_ROW_VALUE_MAX_BYTES = 4096;
export const MONITOR_MAX_ASSERTIONS = 10;
export const MONITOR_ASSERTION_TEXT_MAX_BYTES = 4096;
export const MONITOR_BODY_MAX_BYTES = 65536;
export const MONITOR_MAX_STATUS_RANGES = 10;
export const MONITOR_MAX_JSONPATH_SEGMENTS = 32;
export const MONITOR_TIMEOUT_MIN_SECONDS = 1;
export const MONITOR_TIMEOUT_MAX_SECONDS = 30;
export const MONITOR_INTERVAL_SECONDS = [60, 300, 900] as const;
export const MONITOR_DEFAULT_INTERVAL_SECONDS = 300;
export const MONITOR_DEFAULT_TIMEOUT_SECONDS = 10;
export const MONITOR_DEFAULT_EXPECTED_STATUS = "200-299";
export const MONITOR_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
] as const;

/** Header names the user may never set (OUT-01); `Proxy-*` is matched by prefix. */
export const MONITOR_FORBIDDEN_HEADER_NAMES = [
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
] as const;
export const MONITOR_FORBIDDEN_HEADER_PREFIX = "proxy-";

const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADER_SET: ReadonlySet<string> = new Set(
  MONITOR_FORBIDDEN_HEADER_NAMES,
);

export function isForbiddenMonitorHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    FORBIDDEN_HEADER_SET.has(lower) ||
    lower.startsWith(MONITOR_FORBIDDEN_HEADER_PREFIX)
  );
}

export function isValidMonitorHeaderName(name: string): boolean {
  return HEADER_TOKEN.test(name);
}

const HEADER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_BREAKS = /[\r\n]/;
// Postgres rejects U+0000 in text and jsonb and unpaired surrogate escapes in
// jsonb, and node-pg rewrites them in text, so neither may reach storage.
const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** False for U+0000 and for text that is not well-formed Unicode. */
export function isStorableText(value: string): boolean {
  return !value.includes("\0") && !UNPAIRED_SURROGATE.test(value);
}

/** Allowed ports: 80, 443 and 1024-65535 (AC-28). */
export function isAllowedMonitorPort(port: number): boolean {
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

// ---- Invalid-input reasons (spec: API, errors table) ------------------------

export const MONITOR_INVALID_REASONS = [
  "required",
  "too_long",
  "invalid_format",
  "blocked_scheme",
  "embedded_credentials",
  "blocked_port",
  "blocked_header",
  "duplicate",
  "crlf",
  "auth_header_conflict",
  "invalid_json",
  "invalid_jsonpath",
  "body_assertion_with_head",
  "out_of_range",
  "too_many",
] as const;
export type MonitorInvalidReason = (typeof MONITOR_INVALID_REASONS)[number];
export const monitorInvalidReasonSchema = z.enum(MONITOR_INVALID_REASONS);

export const MONITOR_ERROR_CODES = [
  "MONITOR_INVALID",
  "MONITOR_NOT_FOUND",
  "MONITOR_TARGET_BLOCKED",
  "MONITOR_SECRET_ORIGIN_CHANGED",
  "MONITOR_LIMIT_REACHED",
  "MONITOR_VERSION_CONFLICT",
  "MONITOR_TEST_RATE_LIMITED",
  "RATE_LIMIT_UNAVAILABLE",
] as const;
export type MonitorErrorCode = (typeof MONITOR_ERROR_CODES)[number];

// ---- Parsers ---------------------------------------------------------------

export type MonitorParseResult<T> =
  { ok: true; value: T } | { ok: false; reason: MonitorInvalidReason };

function fail(reason: MonitorInvalidReason): {
  ok: false;
  reason: MonitorInvalidReason;
} {
  return { ok: false, reason };
}

export type StatusRange = { from: number; to: number };

const STATUS_TOKEN = /^(\d{1,3})(?:-(\d{1,3}))?$/;

/** `200-299,301` into ranges (AC-30): codes 100-599, at most 10 ranges or codes. */
export function parseExpectedStatus(
  text: string,
): MonitorParseResult<StatusRange[]> {
  if (text.trim() === "") return fail("required");
  const tokens = text.split(",").map((token) => token.trim());
  if (tokens.length > MONITOR_MAX_STATUS_RANGES) return fail("too_many");
  const ranges: StatusRange[] = [];
  for (const token of tokens) {
    const match = STATUS_TOKEN.exec(token);
    if (!match) return fail("invalid_format");
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 100 || to > 599 || to < from) return fail("out_of_range");
    ranges.push({ from, to });
  }
  return { ok: true, value: ranges };
}

export type PathSegment = string | number;

const PATH_NAME = /[A-Za-z_$][A-Za-z0-9_$-]*/y;
const PATH_KEY = /\['([^'\\]*)'\]/y;
const PATH_INDEX = /\[(0|[1-9][0-9]{0,8})\]/y;

/**
 * JSONPath subset (AC-16): `$`, `.name`, `['name']`, `[index]`. Filters,
 * wildcards and recursive descent are rejected. At most 32 segments.
 */
export function parseJsonPath(
  input: string,
): MonitorParseResult<PathSegment[]> {
  const text = input.trim();
  if (text === "") return fail("required");
  if (!text.startsWith("$")) return fail("invalid_jsonpath");
  const segments: PathSegment[] = [];
  let position = 1;
  while (position < text.length) {
    if (segments.length >= MONITOR_MAX_JSONPATH_SEGMENTS) {
      return fail("too_many");
    }
    if (text[position] === ".") {
      PATH_NAME.lastIndex = position + 1;
      const name = PATH_NAME.exec(text);
      if (!name) return fail("invalid_jsonpath");
      segments.push(name[0]);
      position += 1 + name[0].length;
      continue;
    }
    PATH_KEY.lastIndex = position;
    const key = PATH_KEY.exec(text);
    if (key) {
      segments.push(key[1] ?? "");
      position += key[0].length;
      continue;
    }
    PATH_INDEX.lastIndex = position;
    const index = PATH_INDEX.exec(text);
    if (!index) return fail("invalid_jsonpath");
    segments.push(Number(index[1]));
    position += index[0].length;
  }
  return { ok: true, value: segments };
}

export type JsonScalar = string | number | boolean | null;

/** A valid JSON scalar (number, true, false, null, quoted string), else the text itself (AC-16). */
export function parseExpectedValue(text: string): JsonScalar {
  try {
    const value: unknown = JSON.parse(text);
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return value;
    }
  } catch {
    // Not JSON: compared as text.
  }
  return text;
}

export type MonitorUrlCheck =
  { ok: true } | { ok: false; reason: MonitorInvalidReason };

/**
 * Shape rules of the monitor URL (AC-28). Address policy (private ranges,
 * localhost, DNS) is server-only and reported as `MONITOR_TARGET_BLOCKED`.
 */
export function checkMonitorUrl(raw: string): MonitorUrlCheck {
  if (raw === "") return fail("required");
  if (raw.length > MONITOR_URL_MAX_LENGTH) return fail("too_long");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("invalid_format");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("blocked_scheme");
  }
  if (url.username !== "" || url.password !== "") {
    return fail("embedded_credentials");
  }
  if (url.hostname === "") return fail("invalid_format");
  // The WHATWG parser drops the default port of the scheme.
  if (url.port !== "" && !isAllowedMonitorPort(Number(url.port))) {
    return fail("blocked_port");
  }
  return { ok: true };
}

// ---- Config schema ---------------------------------------------------------

export const monitorMethodSchema = z.enum(MONITOR_METHODS);

const headerRowSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(MONITOR_ROW_NAME_MAX_LENGTH),
  value: z.string().max(MONITOR_ROW_VALUE_MAX_BYTES).optional(),
  secret: z.boolean().default(false),
});

const queryParamRowSchema = z.object({
  name: z.string().min(1).max(MONITOR_ROW_NAME_MAX_LENGTH),
  value: z.string().max(MONITOR_ROW_VALUE_MAX_BYTES),
});

const bodySchema = z.object({
  type: z.enum(["json", "text"]),
  content: z.string().max(MONITOR_BODY_MAX_BYTES),
});

const assertionInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("jsonPathEquals"),
    path: z.string().max(MONITOR_ASSERTION_TEXT_MAX_BYTES),
    expected: z.string().max(MONITOR_ASSERTION_TEXT_MAX_BYTES),
  }),
  z.object({
    kind: z.literal("bodyContains"),
    text: z.string().max(MONITOR_ASSERTION_TEXT_MAX_BYTES),
  }),
  z.object({
    kind: z.literal("responseTimeBelow"),
    ms: z.number().int().min(1),
  }),
]);

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer") }),
  z.object({ type: z.literal("basic") }),
  z.object({
    type: z.literal("apiKey"),
    headerName: z.string().min(1).max(MONITOR_ROW_NAME_MAX_LENGTH),
  }),
]);

// No `mode` field: basic and advanced mode belong to the UI.
// Strict: `secrets` belongs to Task 13 and must not be silently ignored.
export const monitorConfigBaseSchema = z.strictObject({
  name: z.string().trim().min(1).max(MONITOR_NAME_MAX_LENGTH),
  url: z
    .string()
    .trim()
    .max(MONITOR_URL_MAX_LENGTH * 2),
  intervalSeconds: z.number().default(MONITOR_DEFAULT_INTERVAL_SECONDS),
  timeoutSeconds: z
    .number()
    .int()
    .min(MONITOR_TIMEOUT_MIN_SECONDS)
    .max(MONITOR_TIMEOUT_MAX_SECONDS)
    .default(MONITOR_DEFAULT_TIMEOUT_SECONDS),
  method: monitorMethodSchema.default("GET"),
  headers: z.array(headerRowSchema).max(MONITOR_MAX_HEADERS).default([]),
  queryParams: z
    .array(queryParamRowSchema)
    .max(MONITOR_MAX_QUERY_PARAMS)
    .default([]),
  body: bodySchema.nullable().default(null),
  expectedStatus: z.string().max(256).default(MONITOR_DEFAULT_EXPECTED_STATUS),
  assertions: z
    .array(assertionInputSchema)
    .max(MONITOR_MAX_ASSERTIONS)
    .default([]),
  auth: authSchema.default({ type: "none" }),
});

type ConfigBase = z.output<typeof monitorConfigBaseSchema>;

/** Rules a field-level type or length check cannot express. Issues carry `params.reason`. */
function refineMonitorConfig(config: ConfigBase, ctx: z.RefinementCtx): void {
  const add = (
    path: (string | number)[],
    reason: MonitorInvalidReason,
  ): void => {
    ctx.addIssue({ code: "custom", path, message: reason, params: { reason } });
  };

  // Every free-text field passes through here before the field's own rules.
  const badText = (path: (string | number)[], value: string): boolean => {
    if (isStorableText(value)) return false;
    add(path, "invalid_format");
    return true;
  };

  badText(["name"], config.name);
  const url = checkMonitorUrl(config.url);
  if (!badText(["url"], config.url) && !url.ok) add(["url"], url.reason);

  // Every allowed interval (60 s and up) exceeds the 30 s timeout cap, so the
  // "timeout below interval" rule needs no separate check.
  if (
    !(MONITOR_INTERVAL_SECONDS as readonly number[]).includes(
      config.intervalSeconds,
    )
  ) {
    add(["intervalSeconds"], "out_of_range");
  }

  const authHeader =
    config.auth.type === "bearer" || config.auth.type === "basic"
      ? "authorization"
      : config.auth.type === "apiKey"
        ? config.auth.headerName.toLowerCase()
        : null;
  if (config.auth.type === "apiKey") {
    const name = config.auth.headerName;
    if (!isValidMonitorHeaderName(name)) {
      add(["auth", "headerName"], "invalid_format");
    } else if (isForbiddenMonitorHeaderName(name)) {
      add(["auth", "headerName"], "blocked_header");
    }
  }

  const seen = new Set<string>();
  const ids = new Set<string>();
  config.headers.forEach((header, index) => {
    // An id names a future secret slot: a UUID, and never shared by two headers.
    if (header.id !== undefined) {
      if (!HEADER_ID.test(header.id)) {
        add(["headers", index, "id"], "invalid_format");
      } else if (ids.has(header.id.toLowerCase())) {
        add(["headers", index, "id"], "duplicate");
      }
      ids.add(header.id.toLowerCase());
    }
    const lower = header.name.toLowerCase();
    if (!isValidMonitorHeaderName(header.name)) {
      add(["headers", index, "name"], "invalid_format");
    } else if (isForbiddenMonitorHeaderName(header.name)) {
      add(["headers", index, "name"], "blocked_header");
    } else if (seen.has(lower)) {
      add(["headers", index, "name"], "duplicate");
    } else if (authHeader !== null && lower === authHeader) {
      add(["headers", index, "name"], "auth_header_conflict");
    }
    seen.add(lower);
    if (header.secret) return;
    if (header.value === undefined) {
      add(["headers", index, "value"], "required");
    } else if (LINE_BREAKS.test(header.value)) {
      add(["headers", index, "value"], "crlf");
    } else if (badText(["headers", index, "value"], header.value)) {
      // reported
    } else if (utf8Length(header.value) > MONITOR_ROW_VALUE_MAX_BYTES) {
      add(["headers", index, "value"], "too_long");
    }
  });

  config.queryParams.forEach((param, index) => {
    badText(["queryParams", index, "name"], param.name);
    if (badText(["queryParams", index, "value"], param.value)) return;
    if (utf8Length(param.value) > MONITOR_ROW_VALUE_MAX_BYTES) {
      add(["queryParams", index, "value"], "too_long");
    }
  });

  if (config.body !== null) {
    if (badText(["body", "content"], config.body.content)) {
      // reported
    } else if (utf8Length(config.body.content) > MONITOR_BODY_MAX_BYTES) {
      add(["body", "content"], "too_long");
    } else if (config.body.type === "json") {
      try {
        JSON.parse(config.body.content);
      } catch {
        add(["body", "content"], "invalid_json");
      }
    }
  }

  const status = parseExpectedStatus(config.expectedStatus);
  if (!status.ok) add(["expectedStatus"], status.reason);

  config.assertions.forEach((assertion, index) => {
    if (assertion.kind === "responseTimeBelow") {
      if (assertion.ms > config.timeoutSeconds * 1000) {
        add(["assertions", index, "ms"], "out_of_range");
      }
      return;
    }
    if (config.method === "HEAD") {
      add(["assertions", index, "kind"], "body_assertion_with_head");
      return;
    }
    if (assertion.kind === "bodyContains") {
      if (badText(["assertions", index, "text"], assertion.text)) return;
      if (assertion.text === "") {
        add(["assertions", index, "text"], "required");
      } else if (
        utf8Length(assertion.text) > MONITOR_ASSERTION_TEXT_MAX_BYTES
      ) {
        add(["assertions", index, "text"], "too_long");
      }
      return;
    }
    const path = parseJsonPath(assertion.path);
    if (badText(["assertions", index, "path"], assertion.path)) {
      // reported
    } else if (!path.ok) {
      add(["assertions", index, "path"], path.reason);
    }
    if (badText(["assertions", index, "expected"], assertion.expected)) return;
    if (assertion.expected === "") {
      add(["assertions", index, "expected"], "required");
    } else if (
      utf8Length(assertion.expected) > MONITOR_ASSERTION_TEXT_MAX_BYTES
    ) {
      add(["assertions", index, "expected"], "too_long");
    }
  });
}

/** Shared by Create, Edit and Test. Defaults make the web and the server agree (AC-06). */
export const monitorConfigSchema =
  monitorConfigBaseSchema.superRefine(refineMonitorConfig);
export type MonitorConfig = z.output<typeof monitorConfigSchema>;
export type MonitorConfigInput = z.input<typeof monitorConfigSchema>;

export const monitorCreateSchema = monitorConfigBaseSchema
  .extend({ clientRequestId: z.uuid() })
  .superRefine(refineMonitorConfig);
export type MonitorCreateInput = z.output<typeof monitorCreateSchema>;

export const monitorEditSchema = monitorConfigBaseSchema
  .extend({ expectedVersion: z.number().int().min(1) })
  .superRefine(refineMonitorConfig);
export type MonitorEditInput = z.output<typeof monitorEditSchema>;

// ---- Normalized forms stored in the database --------------------------------

export type StoredHeader = {
  id?: string;
  name: string;
  value?: string;
  secret: boolean;
};

/** Superset of the executor's assertion type: the typed text is kept for Edit display. */
export type StoredAssertion =
  | {
      kind: "jsonPathEquals";
      path: string;
      expected: string;
      pathSegments: PathSegment[];
      expectedValue: JsonScalar;
    }
  | { kind: "bodyContains"; text: string }
  | { kind: "responseTimeBelow"; ms: number };

export type NormalizedMonitorStorage = {
  expectedStatusText: string;
  expectedStatusRanges: StatusRange[];
  assertions: StoredAssertion[];
};

/** Call only with a config that passed `monitorConfigSchema`. */
export function normalizeMonitorConfig(
  config: MonitorConfig,
): NormalizedMonitorStorage {
  const status = parseExpectedStatus(config.expectedStatus);
  if (!status.ok) throw new Error("expected status was not validated");
  const assertions = config.assertions.map((assertion): StoredAssertion => {
    if (assertion.kind !== "jsonPathEquals") return assertion;
    const path = parseJsonPath(assertion.path);
    if (!path.ok) throw new Error("JSONPath was not validated");
    return {
      kind: "jsonPathEquals",
      path: assertion.path,
      expected: assertion.expected,
      pathSegments: path.value,
      expectedValue: parseExpectedValue(assertion.expected),
    };
  });
  return {
    expectedStatusText: config.expectedStatus.trim(),
    expectedStatusRanges: status.value,
    assertions,
  };
}

// ---- Views -----------------------------------------------------------------

const isoDateTime = z.iso.datetime();
const monitorIdSchema = z.uuid();
const pageSchema = z.object({
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
});

export const MONITOR_HEALTHS = ["up", "down", "unknown", "paused"] as const;
export const monitorHealthSchema = z.enum(MONITOR_HEALTHS);
export type MonitorHealthName = z.infer<typeof monitorHealthSchema>;
export const monitorHealthReasonSchema = z
  .enum(["never_checked", "stale", "awaiting_new_config", "check_error"])
  .nullable();
export type MonitorHealthReason = z.infer<typeof monitorHealthReasonSchema>;
export const monitorStatusSchema = z.enum(["active", "paused"]);

export const MONITOR_SECRET_SLOT_PATTERN =
  /^(auth\.(token|username|password|apiKey)|header\..+)$/;
export const monitorSecretSlotSchema = z.object({
  slot: z.string().regex(MONITOR_SECRET_SLOT_PATTERN),
  configured: z.literal(true),
});

/** Config, status and version: what Create, Edit, Pause and Resume return, and what Edit displays. */
export const monitorRecordSchema = z.object({
  id: monitorIdSchema,
  name: z.string(),
  url: z.string(),
  method: monitorMethodSchema,
  intervalSeconds: z.number().int(),
  timeoutSeconds: z.number().int(),
  headers: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      value: z.string().optional(),
      secret: z.boolean(),
    }),
  ),
  queryParams: z.array(z.object({ name: z.string(), value: z.string() })),
  body: bodySchema.nullable(),
  expectedStatus: z.string(),
  assertions: z.array(assertionInputSchema),
  auth: authSchema,
  secretSlots: z.array(monitorSecretSlotSchema),
  status: monitorStatusSchema,
  version: z.number().int().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type MonitorRecord = z.infer<typeof monitorRecordSchema>;

export const monitorWriteResponseSchema = z.object({
  monitor: monitorRecordSchema,
});
export type MonitorWriteResponse = z.infer<typeof monitorWriteResponseSchema>;

export const CHECK_OUTCOMES = ["pass", "fail", "check_error"] as const;
export const CHECK_FAILURE_REASONS = [
  "http_status",
  "assertion_failed",
  "timeout",
  "dns_not_found",
  "connect_refused",
  "connect_failed",
  "tls_invalid",
  "blocked_address",
  "redirect_blocked",
  "redirect_limit",
  "body_read_failed",
  "secret_decrypt_failed",
  "internal_egress_failed",
  "resolver_unavailable",
  "executor_error",
] as const;
export const TLS_REASONS = [
  "expired",
  "hostname_mismatch",
  "untrusted",
  "self_signed",
  "handshake_failed",
] as const;
export const ASSERTION_REASONS = [
  "not_json",
  "path_not_found",
  "multiple_matches",
  "type_mismatch",
  "no_body",
  "undecodable",
  "value_mismatch",
  "text_not_found",
  "too_slow",
  "no_response",
] as const;
export const SSL_LEVELS = [
  "ok",
  "caution",
  "danger",
  "expired",
  "not_https",
  "unreadable",
  "no_data",
] as const;

export type SslLevelName = (typeof SSL_LEVELS)[number];

export const checkAssertionResultSchema = z.object({
  kind: z.enum(["jsonPathEquals", "bodyContains", "responseTimeBelow"]),
  expected: z.string(),
  actual: z.string().nullable(),
  actualType: z.string().nullable(),
  actualTruncated: z.boolean(),
  status: z.enum(["pass", "fail", "not_evaluated"]),
  reason: z.enum(ASSERTION_REASONS).nullable(),
});

export type CheckAssertionResult = z.infer<typeof checkAssertionResultSchema>;

export const checkResultSchema = z.object({
  scheduledFor: isoDateTime,
  checkedAt: isoDateTime,
  outcome: z.enum(CHECK_OUTCOMES),
  httpStatus: z.number().int().nullable(),
  responseTimeMs: z.number().int().nullable(),
  failureReason: z.enum(CHECK_FAILURE_REASONS).nullable(),
  tlsReason: z.enum(TLS_REASONS).nullable(),
  assertions: z.array(checkAssertionResultSchema),
  url: z.string(),
  configVersion: z.number().int(),
  evaluatedFromPrefix: z.boolean(),
});

export type CheckResultView = z.infer<typeof checkResultSchema>;

const openIncidentSchema = z
  .object({ startedAt: isoDateTime, reason: z.string() })
  .nullable();

const sslListSchema = z.object({
  level: z.enum(SSL_LEVELS),
  daysRemaining: z.number().int().nullable(),
  host: z.string().nullable(),
});

const uptimeWindowSchema = z.object({
  percent: z.number().min(0).max(100).nullable(),
  checks: z.number().int().min(0),
  coveragePercent: z.number().min(0).max(100),
});

const monitorStateSchema = z.object({
  health: monitorHealthSchema,
  healthReason: monitorHealthReasonSchema,
  lastKnownDown: z.boolean(),
  consecutiveFailures: z.number().int().min(0),
  lastCheckAt: isoDateTime.nullable(),
  openIncident: openIncidentSchema,
});

/** Detail view: the record plus the state computed per request. */
export const monitorSchema = monitorRecordSchema.extend({
  ...monitorStateSchema.shape,
  lastResult: checkResultSchema.nullable(),
  ssl: z.object({
    state: z.enum(SSL_LEVELS),
    host: z.string().nullable(),
    issuer: z.string().nullable(),
    notAfter: isoDateTime.nullable(),
    daysRemaining: z.number().int().nullable(),
    reason: z.string().nullable(),
  }),
  uptime: z.object({
    h24: uptimeWindowSchema,
    d7: uptimeWindowSchema,
    d30: uptimeWindowSchema,
  }),
  dataAsOf: isoDateTime,
});
export type Monitor = z.infer<typeof monitorSchema>;

export const monitorDetailResponseSchema = z.object({ monitor: monitorSchema });
export type MonitorDetailResponse = z.infer<typeof monitorDetailResponseSchema>;

export const monitorListItemSchema = z.object({
  id: monitorIdSchema,
  name: z.string(),
  url: z.string(),
  status: monitorStatusSchema,
  ...monitorStateSchema.shape,
  lastResponseTimeMs: z.number().int().nullable(),
  ssl: sslListSchema,
  uptime: z.object({ h24: uptimeWindowSchema, d30: uptimeWindowSchema }),
});

export const MONITOR_LIST_DEFAULT_LIMIT = 25;
export const MONITOR_HISTORY_DEFAULT_LIMIT = 20;
export const MONITOR_RECENT_EVENTS_MAX = 20;
export const MONITOR_RECENT_EVENTS_DEFAULT = 10;
export const MONITOR_Q_MAX_LENGTH = 200;
/** One point per check over 24 h at the shortest interval (60 s). */
export const MONITOR_RESPONSE_POINTS_MAX = 1440;
export const MONITOR_RESPONSE_RANGES = ["24h", "7d", "30d"] as const;

const pageOffsetSchema = z.coerce.number().int().min(0).default(0);

export const monitorListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(MONITOR_LIST_DEFAULT_LIMIT),
  offset: pageOffsetSchema,
  health: monitorHealthSchema.optional(),
  q: z.string().trim().max(MONITOR_Q_MAX_LENGTH).optional(),
});
export type MonitorListQuery = z.output<typeof monitorListQuerySchema>;

/** Check history and incidents. */
export const monitorHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(MONITOR_HISTORY_DEFAULT_LIMIT),
  offset: pageOffsetSchema,
});
export type MonitorHistoryQuery = z.output<typeof monitorHistoryQuerySchema>;

export const monitorRecentEventsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MONITOR_RECENT_EVENTS_MAX)
    .default(MONITOR_RECENT_EVENTS_DEFAULT),
});

export const monitorResponseTimesQuerySchema = z.object({
  range: z.enum(MONITOR_RESPONSE_RANGES).default("24h"),
});

export const monitorListResponseSchema = z.object({
  summary: z.object({
    up: z.number().int().min(0),
    down: z.number().int().min(0),
    unknown: z.number().int().min(0),
    paused: z.number().int().min(0),
    total: z.number().int().min(0),
    limit: z.literal(MONITOR_LIMIT_PER_ORGANIZATION),
  }),
  monitors: z.array(monitorListItemSchema).max(50),
  page: pageSchema,
  dataAsOf: isoDateTime,
});
export type MonitorListResponse = z.infer<typeof monitorListResponseSchema>;

export const monitorRecentEventSchema = z.object({
  kind: z.enum(["incident_opened", "incident_closed", "ssl_level"]),
  monitorId: monitorIdSchema,
  monitorName: z.string(),
  at: isoDateTime,
  reason: z.string().nullable(),
  durationSeconds: z.number().int().min(0).optional(),
  sslLevel: z.enum(SSL_LEVELS).optional(),
  daysRemaining: z.number().int().optional(),
});
export type MonitorRecentEvent = z.infer<typeof monitorRecentEventSchema>;
export const monitorRecentEventsResponseSchema = z.object({
  events: z.array(monitorRecentEventSchema).max(20),
});

export const monitorChecksResponseSchema = z.object({
  checks: z.array(checkResultSchema).max(50),
  page: pageSchema,
  urlChanges: z.array(z.object({ at: isoDateTime, url: z.string() })),
});
export type MonitorChecksResponse = z.infer<typeof monitorChecksResponseSchema>;

export const monitorIncidentSchema = z.object({
  id: z.uuid(),
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  durationSeconds: z.number().int().min(0),
  startReason: z.string(),
  startHttpStatus: z.number().int().nullable(),
  endReason: z.enum(["recovered", "paused_by_user"]).nullable(),
});
export const monitorIncidentsResponseSchema = z.object({
  incidents: z.array(monitorIncidentSchema).max(50),
  page: pageSchema,
});
export type MonitorIncidentsResponse = z.infer<
  typeof monitorIncidentsResponseSchema
>;

const interval = z.object({ from: isoDateTime, to: isoDateTime });
const responseTimesCommon = {
  unit: z.literal("ms"),
  pauses: z.array(interval),
  configChanges: z.array(
    z.object({
      at: isoDateTime,
      urlChanged: z.boolean(),
      url: z.string().optional(),
    }),
  ),
};
export const monitorResponseTimesResponseSchema = z.discriminatedUnion(
  "range",
  [
    z.object({
      range: z.literal("24h"),
      points: z
        .array(
          z.object({
            at: isoDateTime,
            responseTimeMs: z.number().int().nullable(),
            outcome: z.enum(CHECK_OUTCOMES),
          }),
        )
        .max(MONITOR_RESPONSE_POINTS_MAX),
      gaps: z.array(interval),
      ...responseTimesCommon,
    }),
    z.object({
      range: z.enum(["7d", "30d"]),
      buckets: z
        .array(
          z.object({
            hourStart: isoDateTime,
            avgMs: z.number().nullable(),
            maxMs: z.number().int().nullable(),
            checks: z.number().int().min(0),
          }),
        )
        .max(720),
      ...responseTimesCommon,
    }),
  ],
);
export type MonitorResponseTimesResponse = z.infer<
  typeof monitorResponseTimesResponseSchema
>;

// ---- Route parameters and error envelopes ------------------------------------

export const monitorOrganizationParamsSchema = z.object({
  organizationId: z.uuid(),
});
/** A malformed id must answer 404, not 400, so it is parsed in the handler (AC-48). */
export const monitorParamsSchema = monitorOrganizationParamsSchema.extend({
  monitorId: z.string().max(64),
});

function monitorErrorSchema<Code extends string>(code: Code) {
  return z.object({
    error: z.object({
      code: z.literal(code),
      message: z.string().min(1),
    }),
  });
}

function monitorErrorWithDetails<
  Code extends string,
  Details extends z.ZodType,
>(code: Code, details: Details) {
  return z.object({
    error: z.object({
      code: z.literal(code),
      message: z.string().min(1),
      details,
    }),
  });
}

export const unsupportedMediaTypeErrorResponseSchema = monitorErrorSchema(
  "UNSUPPORTED_MEDIA_TYPE",
);
export const monitorInvalidErrorResponseSchema = monitorErrorWithDetails(
  "MONITOR_INVALID",
  z.object({
    fields: z.array(
      z.object({ field: z.string(), reason: monitorInvalidReasonSchema }),
    ),
  }),
);
export const monitorNotFoundErrorResponseSchema =
  monitorErrorSchema("MONITOR_NOT_FOUND");
export const monitorTargetBlockedErrorResponseSchema = monitorErrorWithDetails(
  "MONITOR_TARGET_BLOCKED",
  z.object({ field: z.literal("url") }),
);
export const monitorLimitReachedErrorResponseSchema = monitorErrorSchema(
  "MONITOR_LIMIT_REACHED",
);
export const monitorVersionConflictErrorResponseSchema =
  monitorErrorWithDetails(
    "MONITOR_VERSION_CONFLICT",
    z.object({ currentVersion: z.number().int().min(1) }),
  );
