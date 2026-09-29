import { sendOutboundRequest, type OutboundDeps } from "@nightwatch/shared";

export const EGRESS_CANARY_TTL_MS = 30_000;
const CANARY_TIMEOUT_MS = 5_000;

/**
 * `unknown`: no canary is configured, so classification uses the error code
 * alone. `failed`: every canary target failed, so the outbound network of the
 * Worker itself is the likely cause of a network-level failure.
 */
export type EgressStatus = "ok" | "failed" | "unknown";

export type EgressCanary = { status(): Promise<EgressStatus> };

export type EgressCanaryOptions = {
  urls: readonly string[];
  /** True when the canary URL answered; the default goes through the SSRF helper. */
  probe?: (url: string) => Promise<boolean>;
  now?: () => number;
  ttlMs?: number;
  outbound?: OutboundDeps;
};

/** One DNS and TLS connection to each canary URL, shared by all checks for 30 s. */
export function createEgressCanary(options: EgressCanaryOptions): EgressCanary {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? EGRESS_CANARY_TTL_MS;
  const probe =
    options.probe ??
    (async (url: string) => {
      const sent = await sendOutboundRequest(
        {
          url,
          method: "HEAD",
          headers: {},
          timeoutMs: CANARY_TIMEOUT_MS,
          maxRedirects: 5,
          secretHeaderNames: [],
          maxBodyBytes: 1024,
        },
        options.outbound,
      );
      // Any HTTP answer proves resolution, routing and TLS work, including a
      // redirect the helper refused to follow.
      return (
        sent.response !== undefined ||
        sent.failure?.reason === "redirect_limit" ||
        sent.failure?.reason === "redirect_blocked"
      );
    });

  if (options.urls.length === 0) {
    return { status: () => Promise.resolve("unknown") };
  }
  let cached: { at: number; result: Promise<EgressStatus> } | null = null;
  return {
    status() {
      if (cached && now() - cached.at < ttlMs) return cached.result;
      const result = Promise.all(
        options.urls.map((url) => probe(url).catch(() => false)),
      ).then((answers): EgressStatus =>
        answers.some(Boolean) ? "ok" : "failed",
      );
      cached = { at: now(), result };
      return result;
    },
  };
}
