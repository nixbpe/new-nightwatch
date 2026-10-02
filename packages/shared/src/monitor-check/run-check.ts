import {
  findInvalidHeader,
  maskUrl,
  sendOutboundRequest,
  type OutboundFailureReason,
} from "../outbound-http";
import { evaluateAssertions } from "./assertions";
import { buildCheckUrl } from "./check-url";
import { createRedactor } from "./redact";
import { buildResponseSnapshot } from "./snapshot";
import {
  outcomeForFailure,
  type CheckDeps,
  type CheckFailureReason,
  type CheckResult,
  type MonitorSecrets,
  type NormalizedMonitorConfig,
} from "./types";

export const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

type Built =
  | {
      ok: true;
      url: string;
      headers: Record<string, string>;
      secretHeaderNames: string[];
      body: string | undefined;
      secretValues: string[];
    }
  | { ok: false; reason: CheckFailureReason };

function buildRequest(
  config: NormalizedMonitorConfig,
  secrets: MonitorSecrets,
): Built {
  const executorError = { ok: false, reason: "executor_error" } as const;
  const secretValues: string[] = [];
  const secret = (slot: string): string | undefined => {
    const value = secrets[slot];
    if (value !== undefined) secretValues.push(value);
    return value;
  };

  const final = buildCheckUrl(config.url, config.queryParams);
  if (!final.ok) {
    return final.reason === "blocked_address"
      ? { ok: false, reason: "blocked_address" }
      : executorError;
  }
  const target = final.url;

  const headers: Record<string, string> = {};
  const secretHeaderNames: string[] = [];
  for (const header of config.headers) {
    if (header.secret) {
      const value =
        header.id === undefined ? undefined : secret(`header.${header.id}`);
      if (value === undefined) return executorError;
      headers[header.name] = value;
      secretHeaderNames.push(header.name);
    } else {
      headers[header.name] = header.value ?? "";
    }
  }

  const setAuth = (name: string, value: string) => {
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === name.toLowerCase()) {
        Reflect.deleteProperty(headers, existing);
      }
    }
    headers[name] = value;
    secretHeaderNames.push(name);
  };
  const { auth } = config;
  if (auth.type === "bearer") {
    const token = secret("auth.token");
    if (token === undefined) return executorError;
    setAuth("Authorization", `Bearer ${token}`);
  } else if (auth.type === "basic") {
    const username = secret("auth.username");
    const password = secret("auth.password");
    if (username === undefined || password === undefined) return executorError;
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    secretValues.push(encoded);
    setAuth("Authorization", `Basic ${encoded}`);
  } else if (auth.type === "apiKey") {
    const key = secret("auth.apiKey");
    if (key === undefined) return executorError;
    setAuth(auth.headerName, key);
  }

  // GET and HEAD never carry a body.
  const sendsBody =
    config.body !== null && config.method !== "GET" && config.method !== "HEAD";
  if (
    sendsBody &&
    !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")
  ) {
    headers["Content-Type"] =
      config.body?.type === "json"
        ? "application/json"
        : "text/plain; charset=utf-8";
  }

  if (findInvalidHeader(headers) !== null) return executorError;
  return {
    ok: true,
    url: target.href,
    headers,
    secretHeaderNames,
    body: sendsBody ? config.body?.content : undefined,
    secretValues,
  };
}

/** `invalid_request` is unreachable for a pre-validated config and maps to `executor_error`. */
function failureReasonFor(reason: OutboundFailureReason): CheckFailureReason {
  return reason === "invalid_request" ? "executor_error" : reason;
}

/**
 * One check: builds the request, sends it through the SSRF helper and
 * evaluates expected status and assertions. Never throws for a target problem;
 * keeps no body and no secret in the result.
 */
export async function runCheck(
  config: NormalizedMonitorConfig,
  secrets: MonitorSecrets,
  deps: CheckDeps = {},
): Promise<CheckResult> {
  const clock = deps.clock ?? (() => new Date());
  const built = buildRequest(config, secrets);
  const redact = createRedactor(
    built.ok ? built.secretValues : Object.values(secrets),
  );
  // Masked query values are all a URL can carry; it has no secret slot, so no cut and no redaction.
  const url = maskUrl(built.ok ? built.url : config.url);

  // A failed build sent nothing, so there is nothing to omit.
  const requestValues =
    built.ok && (built.body !== undefined || new URL(built.url).search !== "");

  const failed = (
    reason: CheckFailureReason,
    extra: Partial<CheckResult> = {},
  ): CheckResult => ({
    outcome: outcomeForFailure(reason),
    checkedAt: clock(),
    httpStatus: null,
    responseTimeMs: null,
    failureReason: reason,
    tlsReason: null,
    assertions: evaluateAssertions(config.assertions, null, redact).results,
    url,
    evaluatedFromPrefix: false,
    tls: null,
    responseSnapshot: buildResponseSnapshot({
      url,
      response: null,
      secretValues: [],
      secretHeaderNames: [],
      requestValues,
    }),
    ...extra,
  });

  if (!built.ok) return failed(built.reason);

  const sent = await sendOutboundRequest(
    {
      url: built.url,
      method: config.method,
      headers: built.headers,
      ...(built.body === undefined ? {} : { body: built.body }),
      timeoutMs: config.timeoutSeconds * 1000,
      maxRedirects: MAX_REDIRECTS,
      secretHeaderNames: built.secretHeaderNames,
      maxBodyBytes: MAX_BODY_BYTES,
      ...(deps.signal ? { signal: deps.signal } : {}),
    },
    deps,
  );
  const tls = sent.tls
    ? {
        host: sent.tls.host,
        issuer: sent.tls.issuer,
        notAfter: sent.tls.notAfter,
      }
    : null;

  if (!sent.ok || !sent.response) {
    const failure = sent.failure;
    return failed(
      failure ? failureReasonFor(failure.reason) : "executor_error",
      {
        tlsReason: failure?.tlsReason ?? sent.tls?.reason ?? null,
        tls,
      },
    );
  }

  const { response } = sent;
  let evaluated: ReturnType<typeof evaluateAssertions>;
  try {
    evaluated = evaluateAssertions(config.assertions, response, redact);
  } catch {
    // An unexpected exception on target-controlled data is a check that could not run.
    return failed("executor_error", {
      tlsReason: null,
      tls,
    });
  }
  const { results, evaluatedFromPrefix } = evaluated;
  const statusOk = config.expectedStatus.some(
    ({ from, to }) => response.status >= from && response.status <= to,
  );
  const reason: CheckFailureReason | null = !statusOk
    ? "http_status"
    : results.some((assertion) => assertion.status === "fail")
      ? "assertion_failed"
      : null;
  return {
    outcome: reason === null ? "pass" : "fail",
    checkedAt: clock(),
    httpStatus: response.status,
    responseTimeMs: response.elapsedMs,
    failureReason: reason,
    tlsReason: null,
    assertions: results,
    url,
    evaluatedFromPrefix,
    tls,
    responseSnapshot: buildResponseSnapshot({
      url,
      response,
      secretValues: built.secretValues,
      secretHeaderNames: built.secretHeaderNames,
      requestValues,
    }),
  };
}
