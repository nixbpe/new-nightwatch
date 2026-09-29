import type { OutboundDeps, TlsReason } from "../outbound-http";

export type MonitorMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export interface StatusRange {
  from: number;
  to: number;
}

export type PathSegment = string | number;
export type JsonScalar = string | number | boolean | null;

/** Assertions as stored after the API parsed them; the executor never parses user text. */
export type NormalizedAssertion =
  | {
      kind: "jsonPathEquals";
      pathSegments: PathSegment[];
      expectedValue: JsonScalar;
    }
  | { kind: "bodyContains"; text: string }
  | { kind: "responseTimeBelow"; ms: number };

export type MonitorAuth =
  | { type: "none" }
  | { type: "bearer" }
  | { type: "basic" }
  | { type: "apiKey"; headerName: string };

export interface MonitorHeader {
  /** Names the secret slot `header.<id>` of a secret header. */
  id?: string;
  name: string;
  value?: string;
  secret: boolean;
}

export interface NormalizedMonitorConfig {
  url: string;
  method: MonitorMethod;
  timeoutSeconds: number;
  headers: MonitorHeader[];
  queryParams: { name: string; value: string }[];
  body: { type: "json" | "text"; content: string } | null;
  expectedStatus: StatusRange[];
  assertions: NormalizedAssertion[];
  auth: MonitorAuth;
}

/**
 * Decrypted secret values keyed by slot: `auth.token`, `auth.username`,
 * `auth.password`, `auth.apiKey`, `header.<headerId>`.
 */
export type MonitorSecrets = Readonly<Record<string, string>>;

export interface CheckDeps extends OutboundDeps {
  clock?: () => Date;
  /** Shutdown abort: the request is torn down and the result is `executor_error` (check_error). */
  signal?: AbortSignal;
}

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
export type CheckFailureReason = (typeof CHECK_FAILURE_REASONS)[number];

export const TLS_REASONS = [
  "expired",
  "hostname_mismatch",
  "untrusted",
  "self_signed",
  "handshake_failed",
] as const satisfies readonly TlsReason[];

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
export type AssertionReason = (typeof ASSERTION_REASONS)[number];

export type CheckOutcome = "pass" | "fail" | "check_error";

export interface AssertionResult {
  kind: NormalizedAssertion["kind"];
  expected: string;
  /** Redacted, then cut at 200 characters. */
  actual: string | null;
  /** JSON type of the value found by a JSONPath assertion. */
  actualType: string | null;
  actualTruncated: boolean;
  status: "pass" | "fail" | "not_evaluated";
  reason: AssertionReason | null;
}

/** Check result view without `scheduledFor` and `configVersion`, which the caller adds. */
export interface CheckResult {
  outcome: CheckOutcome;
  checkedAt: Date;
  httpStatus: number | null;
  responseTimeMs: number | null;
  failureReason: CheckFailureReason | null;
  tlsReason: TlsReason | null;
  assertions: AssertionResult[];
  /** Masked with `maskUrl()`. */
  url: string;
  evaluatedFromPrefix: boolean;
  /** Certificate facts of the last hop, for the SSL state; null for http or no handshake. */
  tls: { host: string; issuer: string | null; notAfter: Date | null } | null;
}

const CHECK_ERROR_REASONS: ReadonlySet<CheckFailureReason> = new Set([
  "secret_decrypt_failed",
  "internal_egress_failed",
  "resolver_unavailable",
  "executor_error",
]);

/** Classification table: check_error reasons never count toward streaks, incidents or uptime. */
export function outcomeForFailure(reason: CheckFailureReason): CheckOutcome {
  return CHECK_ERROR_REASONS.has(reason) ? "check_error" : "fail";
}
