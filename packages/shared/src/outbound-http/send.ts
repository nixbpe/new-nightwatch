import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

import { isForbiddenAddress, sameAddress } from "./address-policy";
import { findInvalidHeader } from "./headers";
import { exchange, type Http1Response } from "./http1";
import { literalHost, maskUrl, validateOutboundUrl } from "./url";

export type TlsReason =
  | "expired"
  | "hostname_mismatch"
  | "untrusted"
  | "self_signed"
  | "handshake_failed";

export type OutboundFailureReason =
  | "blocked_address"
  | "redirect_blocked"
  | "redirect_limit"
  | "timeout"
  | "dns_not_found"
  | "resolver_unavailable"
  | "connect_refused"
  | "connect_failed"
  | "tls_invalid"
  | "body_read_failed"
  | "invalid_request"
  | "executor_error";

export interface OutboundRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs: number;
  maxRedirects: number;
  /** Header names dropped when a redirect leaves the original destination. */
  secretHeaderNames: string[];
  maxBodyBytes: number;
  /** Caller abort (shutdown): tears the request down and reports `executor_error`, not `timeout`. */
  signal?: AbortSignal;
}

export interface OutboundTls {
  /** Hostname of the hop whose certificate was read: lowercase, no port, never a resolved address. */
  host: string;
  reason: TlsReason | null;
  issuer: string | null;
  notAfter: Date | null;
}

export interface OutboundResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  bodyTruncated: boolean;
  /** Masked with `maskUrl()`. */
  finalUrl: string;
  redirects: number;
  elapsedMs: number;
}

export interface OutboundFailure {
  reason: OutboundFailureReason;
  tlsReason?: TlsReason;
  /** Fixed text per reason; never carries a resolved address. */
  message: string;
}

export interface OutboundResult {
  ok: boolean;
  response?: OutboundResponse;
  tls?: OutboundTls;
  failure?: OutboundFailure;
}

/** Test seams. Production callers pass none of these except the env-driven `testAllowedHosts`. */
export interface OutboundDeps {
  resolver?: (hostname: string) => Promise<string[]>;
  /** Hostnames (never IP literals) exempt from the address policy: `OUTBOUND_TEST_ALLOWED_HOSTS`. */
  testAllowedHosts?: readonly string[];
  /** Replaces the runtime CA store. */
  ca?: string | Buffer | (string | Buffer)[];
}

const MESSAGES: Record<OutboundFailureReason, string> = {
  blocked_address: "Target address is not allowed",
  redirect_blocked: "Redirect target is not allowed",
  redirect_limit: "Too many redirects",
  timeout: "Request timed out",
  dns_not_found: "Host name could not be resolved",
  resolver_unavailable: "Name resolution or network unavailable",
  connect_refused: "Connection refused",
  connect_failed: "Connection failed",
  tls_invalid: "TLS certificate could not be verified",
  body_read_failed: "Response could not be read",
  invalid_request: "Request is not allowed",
  executor_error: "Request could not be executed",
};

const MAX_REDIRECTS = 5;
/** Dropped with `secretHeaderNames` whenever a redirect leaves the original destination. */
const DESTINATION_BOUND_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

class OutboundError extends Error {
  constructor(
    readonly reason: OutboundFailureReason,
    readonly tlsReason?: TlsReason,
    readonly tls?: OutboundTls,
  ) {
    super(reason);
  }
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function tlsReasonFor(code: string): TlsReason | null {
  switch (code) {
    case "CERT_HAS_EXPIRED":
      return "expired";
    case "CERT_NOT_YET_VALID":
      // Not expired; the contract has no not-yet-valid value, so it is a failed handshake.
      return "handshake_failed";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "hostname_mismatch";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "self_signed";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "CERT_UNTRUSTED":
      return "untrusted";
    default:
      return null;
  }
}

function classifyConnectError(
  error: unknown,
  secure: boolean,
  tcpConnected: boolean,
  host: string,
): OutboundError {
  if (error instanceof OutboundError) return error;
  const code = errorCode(error);
  // Bun raises a name mismatch with an empty cert when the peer is not speaking TLS at all.
  const cert = (error as { cert?: unknown } | null)?.cert;
  const hasCert =
    typeof cert === "object" && cert !== null && Object.keys(cert).length > 0;
  const tlsReason =
    code === "ERR_TLS_CERT_ALTNAME_INVALID" && !hasCert
      ? null
      : tlsReasonFor(code);
  if (tlsReason) {
    return new OutboundError("tls_invalid", tlsReason, {
      host,
      reason: tlsReason,
      issuer: null,
      notAfter: null,
    });
  }
  if (code === "ECONNREFUSED") return new OutboundError("connect_refused");
  if (code === "ENETUNREACH" || code === "EAI_AGAIN") {
    return new OutboundError("resolver_unavailable");
  }
  if (secure && tcpConnected) {
    return new OutboundError("tls_invalid", "handshake_failed", {
      host,
      reason: "handshake_failed",
      issuer: null,
      notAfter: null,
    });
  }
  return new OutboundError("connect_failed");
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new OutboundError("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new OutboundError("timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof Error ? error : new OutboundError("executor_error"),
        );
      },
    );
  });
}

export type ResolveOutcome =
  | { ok: true; addresses: string[] }
  | {
      ok: false;
      reason: "blocked_address" | "dns_not_found" | "resolver_unavailable";
    };

/**
 * Resolves a host and applies the address policy: any forbidden address rejects
 * the whole answer. Also used by save-time validation (AC-09).
 */
export async function resolveOutboundHost(
  url: URL,
  deps: OutboundDeps = {},
): Promise<ResolveOutcome> {
  const literal = literalHost(url);
  if (literal !== null) {
    return isForbiddenAddress(literal)
      ? { ok: false, reason: "blocked_address" }
      : { ok: true, addresses: [literal] };
  }
  let addresses: string[];
  try {
    addresses = await (deps.resolver ?? defaultResolver)(url.hostname);
  } catch (error) {
    const code = errorCode(error);
    if (
      code === "EAI_AGAIN" ||
      code === "ENETUNREACH" ||
      code === "ECONNREFUSED"
    ) {
      return { ok: false, reason: "resolver_unavailable" };
    }
    return { ok: false, reason: "dns_not_found" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns_not_found" };
  const exempt = (deps.testAllowedHosts ?? []).some(
    (host) => host.toLowerCase() === url.hostname.toLowerCase(),
  );
  if (!exempt && addresses.some(isForbiddenAddress)) {
    return { ok: false, reason: "blocked_address" };
  }
  return { ok: true, addresses };
}

interface OpenedSocket {
  socket: net.Socket;
  tls: OutboundTls | null;
}

function connectOnce(
  address: string,
  url: URL,
  deps: OutboundDeps,
  signal: AbortSignal,
  attempt: { ms: number | null; deadline: number },
  track: (socket: net.Socket) => void,
): Promise<OpenedSocket> {
  const secure = url.protocol === "https:";
  const port = Number(url.port || (secure ? 443 : 80));
  return abortable(
    new Promise<OpenedSocket>((resolve, reject) => {
      let tcpConnected = false;
      let socket: net.Socket;
      // The last address has no attempt timer: the global abort reports it as a timeout.
      const attemptTimer =
        attempt.ms === null
          ? undefined
          : setTimeout(() => {
              socket.destroy();
              reject(
                new OutboundError(
                  Date.now() >= attempt.deadline ? "timeout" : "connect_failed",
                ),
              );
            }, attempt.ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(attemptTimer);
        },
        { once: true },
      );
      const settle = <T>(finish: (value: T) => void, value: T) => {
        clearTimeout(attemptTimer);
        finish(value);
      };
      const onError = (error: unknown) => {
        const connected = tcpConnected || socket.remoteAddress !== undefined;
        socket.destroy();
        settle(
          reject,
          classifyConnectError(error, secure, connected, url.hostname),
        );
      };
      // Connection-time check: the socket must be on the address that was validated.
      const remoteMatches = (): boolean => {
        if (
          socket.remoteAddress &&
          sameAddress(socket.remoteAddress, address)
        ) {
          return true;
        }
        socket.destroy();
        settle(reject, new OutboundError("blocked_address"));
        return false;
      };
      if (secure) {
        const literal = literalHost(url) !== null;
        const secureSocket = tls.connect({
          host: address,
          port,
          // SNI and certificate name checks use the original hostname, not the pinned IP.
          ...(literal ? {} : { servername: url.hostname }),
          ca: deps.ca,
          rejectUnauthorized: true,
        });
        socket = secureSocket;
        socket.once("connect", () => {
          tcpConnected = true;
          remoteMatches();
        });
        socket.once("secureConnect", () => {
          // Checked again here so the guarantee does not rest on `connect` firing on a TLSSocket.
          if (!remoteMatches()) return;
          // An empty object comes back when no certificate is available.
          const peer: Partial<tls.PeerCertificate> =
            secureSocket.getPeerCertificate();
          const issuer = peer.issuer?.O ?? peer.issuer?.CN;
          const notAfter = peer.valid_to ? new Date(peer.valid_to) : null;
          settle(resolve, {
            socket,
            tls: {
              host: url.hostname,
              reason: null,
              issuer: (Array.isArray(issuer) ? issuer[0] : issuer) ?? null,
              notAfter:
                notAfter && !Number.isNaN(notAfter.getTime()) ? notAfter : null,
            },
          });
        });
      } else {
        socket = net.connect({ host: address, port });
        socket.once("connect", () => {
          tcpConnected = true;
          if (remoteMatches()) settle(resolve, { socket, tls: null });
        });
      }
      socket.once("error", onError);
      track(socket);
    }),
    signal,
  );
}

async function openSocket(
  addresses: string[],
  url: URL,
  deps: OutboundDeps,
  signal: AbortSignal,
  deadline: number,
  track: (socket: net.Socket) => void,
): Promise<OpenedSocket> {
  let last: OutboundError = new OutboundError("connect_failed");
  for (const [index, address] of addresses.entries()) {
    // Each attempt gets an equal share of what is left, so a blackholed address cannot use it all.
    const isLast = index === addresses.length - 1;
    const attemptMs = Math.max(
      1,
      (deadline - Date.now()) / (addresses.length - index),
    );
    try {
      const opened = await connectOnce(
        address,
        url,
        deps,
        signal,
        { ms: isLast ? null : attemptMs, deadline },
        track,
      );
      // Only errors raised after this point belong to the request phase.
      opened.socket.removeAllListeners("error");
      return opened;
    } catch (error) {
      const failure =
        error instanceof OutboundError
          ? error
          : new OutboundError("connect_failed");
      if (
        failure.reason === "timeout" ||
        failure.reason === "tls_invalid" ||
        failure.reason === "blocked_address"
      ) {
        throw failure;
      }
      last = failure;
    }
  }
  throw last;
}

/** Secret headers travel only to the same origin, or on a default-port http to https upgrade (AC-44). */
export function sameDestination(from: URL, to: URL): boolean {
  if (from.hostname !== to.hostname) return false;
  if (from.origin === to.origin) return true;
  return (
    from.protocol === "http:" &&
    to.protocol === "https:" &&
    from.port === "" &&
    to.port === ""
  );
}

/**
 * Sends one request through the SSRF policy.
 *
 * `failure.reason` includes `invalid_request` for a URL, method or header that
 * the policy rejects before any connection. Callers pre-validate with
 * `validateOutboundUrl` and `findInvalidHeader`; the check executor maps this
 * value to `executor_error` (check_error). `maxRedirects` is capped at 5, and
 * any redirect beyond the cap (including a cap of 0) is `redirect_limit`.
 */
export async function sendOutboundRequest(
  request: OutboundRequest,
  deps: OutboundDeps = {},
): Promise<OutboundResult> {
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, request.timeoutMs);
  const caller = { aborted: false };
  const onCallerAbort = () => {
    caller.aborted = true;
    abort.abort();
  };
  request.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const sockets = new Set<net.Socket>();
  let lastTls: OutboundTls | undefined;
  try {
    if (request.signal?.aborted) throw new OutboundError("executor_error");
    const method = request.method.toUpperCase();
    const first = validateOutboundUrl(request.url);
    if (!METHODS.has(method) || findInvalidHeader(request.headers) !== null) {
      throw new OutboundError("invalid_request");
    }
    if (!first.ok) {
      throw new OutboundError(
        first.reason === "blocked_address"
          ? "blocked_address"
          : "invalid_request",
      );
    }

    const secretNames = new Set(
      request.secretHeaderNames.map((name) => name.toLowerCase()),
    );
    let current = first.url;
    let currentMethod = method;
    let body: Uint8Array | undefined =
      typeof request.body === "string"
        ? Buffer.from(request.body)
        : request.body;
    let keepSecrets = true;
    const seen = new Set([current.href]);

    for (let redirects = 0; ; redirects++) {
      lastTls = undefined;
      const hopBlocked =
        redirects === 0 ? "blocked_address" : "redirect_blocked";
      const resolved = await abortable(
        resolveOutboundHost(current, deps),
        abort.signal,
      );
      if (!resolved.ok) {
        throw new OutboundError(
          resolved.reason === "blocked_address" ? hopBlocked : resolved.reason,
        );
      }

      let opened: OpenedSocket;
      try {
        opened = await openSocket(
          resolved.addresses,
          current,
          deps,
          abort.signal,
          started + request.timeoutMs,
          (socket) => {
            sockets.add(socket);
          },
        );
      } catch (error) {
        // The connection-time address check follows the same hop naming as the DNS check.
        if (
          error instanceof OutboundError &&
          error.reason === "blocked_address"
        ) {
          throw new OutboundError(hopBlocked);
        }
        throw error;
      }
      lastTls = opened.tls ?? undefined;

      const headers = Object.entries(request.headers).filter(
        ([name]) =>
          (keepSecrets ||
            !(
              secretNames.has(name.toLowerCase()) ||
              DESTINATION_BOUND_HEADERS.has(name.toLowerCase())
            )) &&
          name.toLowerCase() !== "accept-encoding",
      );
      // No request byte after an abort, even if it landed while the socket was opening.
      if (abort.signal.aborted) throw new OutboundError("timeout");
      let response: Http1Response;
      try {
        response = await abortable(
          exchange(
            opened.socket,
            {
              method: currentMethod,
              target: `${current.pathname}${current.search}`,
              host: current.host,
              headers,
              body,
            },
            {
              maxBodyBytes: request.maxBodyBytes,
              skipBody: (status, responseHeaders) =>
                REDIRECT_STATUSES.has(status) &&
                responseHeaders["location"] !== undefined,
            },
          ),
          abort.signal,
        );
      } catch (error) {
        if (error instanceof OutboundError) throw error;
        throw new OutboundError("body_read_failed");
      } finally {
        opened.socket.destroy();
      }

      const location = response.headers["location"];
      if (!REDIRECT_STATUSES.has(response.status) || location === undefined) {
        return {
          ok: true,
          response: {
            status: response.status,
            headers: response.headers,
            body: response.body,
            bodyTruncated: response.bodyTruncated,
            finalUrl: maskUrl(current.href),
            redirects,
            elapsedMs: Date.now() - started,
          },
          ...(opened.tls ? { tls: opened.tls } : {}),
        };
      }

      if (redirects >= Math.min(request.maxRedirects, MAX_REDIRECTS))
        throw new OutboundError("redirect_limit");
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new OutboundError("redirect_blocked");
      }
      if (next.hash) next.hash = "";
      if (current.protocol === "https:" && next.protocol === "http:") {
        throw new OutboundError("redirect_blocked");
      }
      const checked = validateOutboundUrl(next.href);
      if (!checked.ok) throw new OutboundError("redirect_blocked");
      if (seen.has(checked.url.href)) throw new OutboundError("redirect_limit");
      seen.add(checked.url.href);

      keepSecrets = keepSecrets && sameDestination(current, checked.url);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          currentMethod !== "GET" &&
          currentMethod !== "HEAD")
      ) {
        currentMethod = currentMethod === "HEAD" ? "HEAD" : "GET";
        body = undefined;
      }
      current = checked.url;
    }
  } catch (caught) {
    const error = abort.signal.aborted
      ? new OutboundError(caller.aborted ? "executor_error" : "timeout")
      : caught instanceof OutboundError
        ? caught
        : new OutboundError("executor_error");
    // lastTls is set only once a handshake finished on the current hop, so a request-phase
    // timeout keeps that hop's certificate and a handshake-phase one has none.
    const tlsInfo = error.tls ?? (caller.aborted ? undefined : lastTls);
    return {
      ok: false,
      failure: {
        reason: error.reason,
        ...(error.tlsReason ? { tlsReason: error.tlsReason } : {}),
        message: MESSAGES[error.reason],
      },
      ...(tlsInfo ? { tls: tlsInfo } : {}),
    };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onCallerAbort);
    for (const socket of sockets) socket.destroy();
  }
}
