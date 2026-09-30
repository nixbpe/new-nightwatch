import { withTenantContextRaw, type Database } from "@nightwatch/db";
import {
  decryptSecret,
  maskUrl,
  runCheck,
  type CheckFailureReason,
  type CheckResult,
  type CredentialEnv,
  type Logger,
  type MonitorSecrets,
  type NormalizedAssertion,
  type NormalizedMonitorConfig,
  type OutboundDeps,
  type StatusRange,
} from "@nightwatch/shared";
import { z } from "zod";

import type { EgressCanary } from "./egress-canary";
import type { MonitorCheckJob } from "./queue";
import { recordCheckResult, type MonitorEventHook } from "./record-result";

const monitorCheckJobSchema = z.object({
  tenantId: z.uuid(),
  monitorId: z.uuid(),
  claimToken: z.string().min(1),
  checkConfigVersion: z.number().int().min(1),
  scheduledFor: z.iso.datetime(),
});

export function assertMonitorCheckJob(
  value: unknown,
): asserts value is MonitorCheckJob {
  monitorCheckJobSchema.parse(value);
}

export type CheckerDependencies = {
  database: Database;
  credentialEnv: CredentialEnv;
  logger: Logger;
  /** Resolver, `OUTBOUND_TEST_ALLOWED_HOSTS` and CA store; test seams for the SSRF helper. */
  outbound?: OutboundDeps;
  clock?: () => Date;
  /** Distinguishes a target failure from an outage of the Worker's own egress. */
  canary?: EgressCanary;
  /** Aborted on shutdown: a check still running then is abandoned and leaves a gap. */
  signal?: AbortSignal;
  /** Overrides `onMonitorEvent`; tests observe incident events with it. */
  onEvent?: MonitorEventHook;
};

export type CheckerOutcome =
  "recorded" | "duplicate" | "discarded" | "skipped" | "aborted";

/** Failures that a broken outbound network of the Worker would also produce. */
const NETWORK_FAILURES: ReadonlySet<CheckFailureReason> = new Set([
  "dns_not_found",
  "connect_refused",
  "connect_failed",
  "timeout",
]);

type StoredHeader = {
  id?: string;
  name: string;
  value?: string;
  secret: boolean;
};

type StoredAssertion =
  | {
      kind: "jsonPathEquals";
      pathSegments: (string | number)[];
      expectedValue: string | number | boolean | null;
    }
  | { kind: "bodyContains"; text: string }
  | { kind: "responseTimeBelow"; ms: number };

type LoadedMonitor = {
  status: "active" | "paused";
  check_config_version: number;
  url: string;
  method: NormalizedMonitorConfig["method"];
  headers: StoredHeader[];
  query_params: { name: string; value: string }[];
  body_type: "json" | "text" | null;
  body_content: string | null;
  auth_type: "none" | "bearer" | "basic" | "apiKey";
  api_key_header_name: string | null;
  expected_status_ranges: StatusRange[];
  assertions: StoredAssertion[];
  interval_seconds: number;
  timeout_seconds: number;
  schedule_claim_token: string | null;
  schedule_check_config_version: number;
  /** Bytes are hex so they survive json_agg. */
  secrets: {
    slot: string;
    key_version: string;
    iv: string;
    auth_tag: string;
    ciphertext: string;
  }[];
};

type LoadedSecret = {
  slot: string;
  key_version: string;
  iv: Buffer;
  auth_tag: Buffer;
  ciphertext: Buffer;
};

/** Everything the check needs; no URL, header or secret ever leaves this process. */
type Prepared = {
  config: NormalizedMonitorConfig;
  secrets: LoadedSecret[];
  intervalSeconds: number;
};

function toConfig(row: LoadedMonitor): NormalizedMonitorConfig {
  return {
    url: row.url,
    method: row.method,
    timeoutSeconds: row.timeout_seconds,
    headers: row.headers.map((header) => ({
      ...(header.id === undefined ? {} : { id: header.id }),
      name: header.name,
      ...(header.value === undefined ? {} : { value: header.value }),
      secret: header.secret,
    })),
    queryParams: row.query_params,
    body:
      row.body_type === null
        ? null
        : { type: row.body_type, content: row.body_content ?? "" },
    expectedStatus: row.expected_status_ranges,
    assertions: row.assertions.map((assertion): NormalizedAssertion =>
      assertion.kind === "jsonPathEquals"
        ? {
            kind: assertion.kind,
            pathSegments: assertion.pathSegments,
            expectedValue: assertion.expectedValue,
          }
        : assertion.kind === "bodyContains"
          ? { kind: assertion.kind, text: assertion.text }
          : { kind: assertion.kind, ms: assertion.ms },
    ),
    auth:
      row.auth_type === "apiKey"
        ? { type: "apiKey", headerName: row.api_key_header_name ?? "" }
        : { type: row.auth_type },
  };
}

/**
 * Transaction A: load what the check needs, or null when the claim is stale.
 * The monitor row and its secret slots come from one statement, so they share
 * one snapshot: an Edit committing in between cannot pair a new secret with the
 * old URL (transactions are READ COMMITTED, one snapshot per statement).
 */
async function prepare(
  database: Database,
  job: MonitorCheckJob,
): Promise<Prepared | null> {
  return withTenantContextRaw(database, job.tenantId, async (client) => {
    const found = await client.query<LoadedMonitor>(
      `select m.status, m.check_config_version, m.url, m.method, m.headers,
              m.query_params, m.body_type, m.body_content, m.auth_type,
              m.api_key_header_name, m.expected_status_ranges, m.assertions,
              m.interval_seconds, m.timeout_seconds,
              s.claim_token as schedule_claim_token,
              s.check_config_version as schedule_check_config_version,
              (select coalesce(json_agg(json_build_object(
                        'slot', ms.slot, 'key_version', ms.key_version,
                        'iv', encode(ms.iv, 'hex'),
                        'auth_tag', encode(ms.auth_tag, 'hex'),
                        'ciphertext', encode(ms.ciphertext, 'hex'))), '[]'::json)
                 from monitor_secrets as ms
                where ms.monitor_id = m.id and ms.tenant_id = m.tenant_id) as secrets
       from monitors as m
       join monitor_schedule as s on s.monitor_id = m.id
       where m.id = $1 and m.tenant_id = $2`,
      [job.monitorId, job.tenantId],
    );
    const row = found.rows[0];
    if (
      !row ||
      row.status !== "active" ||
      row.schedule_claim_token !== job.claimToken ||
      row.check_config_version !== job.checkConfigVersion ||
      row.schedule_check_config_version !== job.checkConfigVersion
    ) {
      return null;
    }
    return {
      config: toConfig(row),
      secrets: row.secrets.map((secret): LoadedSecret => ({
        slot: secret.slot,
        key_version: secret.key_version,
        iv: Buffer.from(secret.iv, "hex"),
        auth_tag: Buffer.from(secret.auth_tag, "hex"),
        ciphertext: Buffer.from(secret.ciphertext, "hex"),
      })),
      intervalSeconds: row.interval_seconds,
    };
  });
}

/** Slots the request actually uses; a stored slot the config ignores never blocks a check. */
function requiredSlots(config: NormalizedMonitorConfig): string[] {
  const slots: string[] = [];
  if (config.auth.type === "bearer") slots.push("auth.token");
  if (config.auth.type === "basic") {
    slots.push("auth.username", "auth.password");
  }
  if (config.auth.type === "apiKey") slots.push("auth.apiKey");
  for (const header of config.headers) {
    if (header.secret && header.id !== undefined) {
      slots.push(`header.${header.id}`);
    }
  }
  return slots;
}

/**
 * Decrypts in memory only. A required slot that is missing or cannot be
 * decrypted is left out of the map; runCheck then sends nothing and reports
 * `executor_error`, which the caller turns into `secret_decrypt_failed`.
 */
function decryptSecrets(
  job: MonitorCheckJob,
  prepared: Prepared,
  env: CredentialEnv,
): { secrets: MonitorSecrets; complete: boolean } {
  const secrets: Record<string, string> = {};
  const stored = new Map(prepared.secrets.map((row) => [row.slot, row]));
  let complete = true;
  for (const slot of requiredSlots(prepared.config)) {
    const row = stored.get(slot);
    if (!row) {
      complete = false;
      continue;
    }
    try {
      secrets[slot] = decryptSecret(
        {
          tenantId: job.tenantId,
          monitorId: job.monitorId,
          slot,
          keyVersion: row.key_version,
          iv: row.iv,
          authTag: row.auth_tag,
          ciphertext: row.ciphertext,
        },
        env,
      );
    } catch {
      complete = false;
    }
  }
  return { secrets, complete };
}

/** Resolves on abort; `dispose` removes the listener so a finished check leaves none behind. */
function abandonment(signal: AbortSignal | undefined): {
  aborted: Promise<"aborted">;
  dispose(): void;
} {
  if (!signal) return { aborted: new Promise(() => undefined), dispose() {} };
  let listener: () => void = () => undefined;
  const aborted = new Promise<"aborted">((resolve) => {
    listener = () => {
      resolve("aborted");
    };
    signal.addEventListener("abort", listener, { once: true });
  });
  return {
    aborted,
    dispose() {
      signal.removeEventListener("abort", listener);
    },
  };
}

/**
 * One queued check: load (tx A), send outside any transaction, then record
 * (tx B). Never rejects for target-controlled input.
 */
export async function processMonitorCheck(
  job: MonitorCheckJob,
  dependencies: CheckerDependencies,
): Promise<CheckerOutcome> {
  const { database, logger } = dependencies;
  const prepared = await prepare(database, job);
  if (!prepared) return "skipped";

  const started = Date.now();
  const { secrets, complete } = decryptSecrets(
    job,
    prepared,
    dependencies.credentialEnv,
  );
  const signal = dependencies.signal;
  if (signal?.aborted) return "aborted";
  const running = runCheck(prepared.config, secrets, {
    ...dependencies.outbound,
    ...(dependencies.clock ? { clock: dependencies.clock } : {}),
    ...(signal ? { signal } : {}),
  }).catch(
    // runCheck is meant not to reject; a rejection is still a check that could not run.
    (): CheckResult => ({
      outcome: "check_error",
      checkedAt: (dependencies.clock ?? (() => new Date()))(),
      httpStatus: null,
      responseTimeMs: null,
      failureReason: "executor_error",
      tlsReason: null,
      assertions: [],
      url: maskUrl(prepared.config.url),
      evaluatedFromPrefix: false,
      tls: null,
    }),
  );
  const abandon = abandonment(signal);
  const finished = await Promise.race([running, abandon.aborted]).finally(
    () => {
      abandon.dispose();
    },
  );
  // A check that ended because of the abort is a gap, never a check_error row.
  if (finished === "aborted" || signal?.aborted) {
    logger.warn(
      { tenantId: job.tenantId, monitorId: job.monitorId },
      "monitor check abandoned on shutdown",
    );
    return "aborted";
  }
  let result: CheckResult = finished;
  if (
    result.outcome === "fail" &&
    result.failureReason !== null &&
    NETWORK_FAILURES.has(result.failureReason) &&
    (await dependencies.canary?.status()) === "failed"
  ) {
    result = {
      ...result,
      outcome: "check_error",
      failureReason: "internal_egress_failed",
    };
  }
  if (!complete) {
    result = {
      ...result,
      outcome: "check_error",
      failureReason: "secret_decrypt_failed",
    };
  }

  const outcome = await recordCheckResult(
    database,
    {
      tenantId: job.tenantId,
      monitorId: job.monitorId,
      claimToken: job.claimToken,
      checkConfigVersion: job.checkConfigVersion,
      scheduledFor: new Date(job.scheduledFor),
      intervalSeconds: prepared.intervalSeconds,
      result,
    },
    dependencies.onEvent ? { onEvent: dependencies.onEvent } : {},
  );
  logger.info(
    {
      tenantId: job.tenantId,
      monitorId: job.monitorId,
      outcome: result.outcome,
      failureReason: result.failureReason,
      durationMs: Date.now() - started,
    },
    "monitor check finished",
  );
  return outcome;
}
