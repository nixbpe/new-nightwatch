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
}

export interface OutboundTls {
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
    case "CERT_NOT_YET_VALID":
      return "expired";
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
): OutboundError {
  if (error instanceof OutboundError) return error;
  const code = errorCode(error);
  const tlsReason = tlsReasonFor(code);
  if (tlsReason) {
    return new OutboundError("tls_invalid", tlsReason, {
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
  track: (socket: net.Socket) => void,
): Promise<OpenedSocket> {
  const secure = url.protocol === "https:";
  const port = Number(url.port || (secure ? 443 : 80));
  return abortable(
    new Promise<OpenedSocket>((resolve, reject) => {
      let tcpConnected = false;
      let socket: net.Socket;
      const onError = (error: unknown) => {
        socket.destroy();
        reject(classifyConnectError(error, secure, tcpConnected));
      };
      const onTcpConnect = () => {
        tcpConnected = true;
        // Connection-time check: the socket must be on the address that was validated.
        if (
          !socket.remoteAddress ||
          !sameAddress(socket.remoteAddress, address)
        ) {
          socket.destroy();
          reject(new OutboundError("blocked_address"));
        }
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
        socket.once("connect", onTcpConnect);
        socket.once("secureConnect", () => {
          // An empty object comes back when no certificate is available.
          const peer: Partial<tls.PeerCertificate> =
            secureSocket.getPeerCertificate();
          const issuer = peer.issuer?.O ?? peer.issuer?.CN;
          const notAfter = peer.valid_to ? new Date(peer.valid_to) : null;
          resolve({
            socket,
            tls: {
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
          onTcpConnect();
          if (!socket.destroyed) resolve({ socket, tls: null });
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
  track: (socket: net.Socket) => void,
): Promise<OpenedSocket> {
  let last: OutboundError = new OutboundError("connect_failed");
  for (const address of addresses) {
    try {
      const opened = await connectOnce(address, url, deps, signal, track);
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

export async function sendOutboundRequest(
  request: OutboundRequest,
  deps: OutboundDeps = {},
): Promise<OutboundResult> {
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, request.timeoutMs);
  const sockets = new Set<net.Socket>();
  let lastTls: OutboundTls | undefined;
  try {
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

      const opened = await openSocket(
        resolved.addresses,
        current,
        deps,
        abort.signal,
        (socket) => {
          sockets.add(socket);
        },
      );
      lastTls = opened.tls ?? undefined;

      const headers = Object.entries(request.headers).filter(
        ([name]) =>
          (keepSecrets || !secretNames.has(name.toLowerCase())) &&
          name.toLowerCase() !== "accept-encoding",
      );
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

      if (redirects >= request.maxRedirects)
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
      ? new OutboundError("timeout")
      : caught instanceof OutboundError
        ? caught
        : new OutboundError("executor_error");
    const tlsInfo =
      error.tls ?? (error.reason === "timeout" ? undefined : lastTls);
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
    for (const socket of sockets) socket.destroy();
  }
}
