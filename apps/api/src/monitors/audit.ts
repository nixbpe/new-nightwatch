import type { StoredAssertion } from "@nightwatch/api-contract";
import {
  AppError,
  buildCheckUrl,
  maskUrl,
  type Logger,
} from "@nightwatch/shared";

import type { AuditChange, AuditValue } from "../audit/record";
import type { StoredConfig } from "./record";

export type MonitorDenialAction =
  `organization.monitor.${"list" | "read" | "create" | "update" | "pause" | "resume" | "delete" | "test"}`;

// Names only, never values: this is what `monitorAuditChanges` may learn about
// the secret slots a request wrote or removed.
export type SecretSlotChanges = {
  /** Slots the request wrote, by canonical slot name. */
  written: string[];
  /** Slots that held a value before the request. */
  stored: ReadonlySet<string>;
  /** Slots the saved config no longer uses. */
  deleted: string[];
};

type AuditConfig = Pick<
  StoredConfig,
  | "name"
  | "url"
  | "method"
  | "intervalSeconds"
  | "timeoutSeconds"
  | "headers"
  | "queryParams"
  | "bodyType"
  | "bodyContent"
  | "authType"
  | "apiKeyHeaderName"
  | "expectedStatusText"
  | "assertions"
>;

const value = (input: string | number | boolean | null): AuditValue => ({
  kind: "value",
  value: input,
});

function scalarChange(
  field: string,
  before: string | number | null,
  after: string | number | null,
): AuditChange[] {
  return before === after
    ? []
    : [
        {
          field,
          before: before === null ? null : value(before),
          after: after === null ? null : value(after),
        },
      ];
}

// The stored URL has no secrets, but its query may carry tokens: every query
// value is masked, as in history.
function maskedUrl(url: string): string {
  const built = buildCheckUrl(url, []);
  return maskUrl(built.ok ? built.url.href : url);
}

function nonSecretHeaders(config: AuditConfig): Map<string, string> {
  return new Map(
    config.headers.flatMap((header) =>
      header.secret ? [] : [[header.name, header.value ?? ""] as const],
    ),
  );
}

function assertionText(assertion: StoredAssertion): string {
  if (assertion.kind === "bodyContains")
    return `bodyContains ${assertion.text}`;
  if (assertion.kind === "responseTimeBelow") {
    return `responseTimeBelow ${String(assertion.ms)}`;
  }
  const path = assertion.pathSegments
    .map((segment) =>
      typeof segment === "number" ? `[${String(segment)}]` : `.${segment}`,
    )
    .join("");
  return `jsonPathEquals $${path} = ${JSON.stringify(assertion.expectedValue)}`;
}

function slotLabel(
  slot: string,
  previous: AuditConfig,
  next: AuditConfig,
): string {
  if (!slot.startsWith("header.")) return slot;
  const id = slot.slice("header.".length);
  const header = [...next.headers, ...previous.headers].find(
    (candidate) => candidate.id?.toLowerCase() === id,
  );
  return header?.name ?? slot;
}

/**
 * Non-secret before/after of an Edit (OD-17, OD-19). Query values and the
 * request body are compared but never copied into the result; secret slots
 * appear by name only. It receives slot names, never secret values.
 */
export function monitorAuditChanges(
  previous: AuditConfig,
  next: AuditConfig,
  secrets: SecretSlotChanges,
): AuditChange[] {
  const changes: AuditChange[] = [
    ...scalarChange("name", previous.name, next.name),
    ...(previous.url === next.url
      ? []
      : scalarChange("url", maskedUrl(previous.url), maskedUrl(next.url))),
    ...scalarChange("method", previous.method, next.method),
    ...scalarChange(
      "intervalSeconds",
      previous.intervalSeconds,
      next.intervalSeconds,
    ),
    ...scalarChange(
      "timeoutSeconds",
      previous.timeoutSeconds,
      next.timeoutSeconds,
    ),
    ...scalarChange("authType", previous.authType, next.authType),
    ...scalarChange(
      "apiKeyHeaderName",
      previous.apiKeyHeaderName,
      next.apiKeyHeaderName,
    ),
    ...scalarChange(
      "expectedStatus",
      previous.expectedStatusText,
      next.expectedStatusText,
    ),
  ];

  const before = nonSecretHeaders(previous);
  const after = nonSecretHeaders(next);
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(name);
    const to = after.get(name);
    if (from === to) continue;
    changes.push({
      field: "header",
      key: name,
      before: from === undefined ? null : value(from),
      after: to === undefined ? null : value(to),
    });
  }

  const queryBefore = new Map(
    previous.queryParams.map((p) => [p.name, p.value]),
  );
  const queryAfter = new Map(next.queryParams.map((p) => [p.name, p.value]));
  for (const name of new Set([...queryBefore.keys(), ...queryAfter.keys()])) {
    const from = queryBefore.get(name);
    const to = queryAfter.get(name);
    if (from === to) continue;
    changes.push({
      field: "queryParam",
      key: name,
      before: from === undefined ? null : { kind: "masked" },
      after: to === undefined ? null : { kind: "masked" },
    });
  }

  if (
    previous.bodyType !== next.bodyType ||
    previous.bodyContent !== next.bodyContent
  ) {
    changes.push({ field: "body", before: null, after: { kind: "changed" } });
  }

  const assertionsBefore = new Set(previous.assertions.map(assertionText));
  const assertionsAfter = new Set(next.assertions.map(assertionText));
  for (const text of assertionsBefore) {
    if (!assertionsAfter.has(text)) {
      changes.push({ field: "assertions", before: value(text), after: null });
    }
  }
  for (const text of assertionsAfter) {
    if (!assertionsBefore.has(text)) {
      changes.push({ field: "assertions", before: null, after: value(text) });
    }
  }

  return [...changes, ...secretChanges(previous, next, secrets)];
}

// Secret slots a request wrote or removed, by name.
function secretChanges(
  previous: AuditConfig,
  next: AuditConfig,
  secrets: SecretSlotChanges,
): AuditChange[] {
  return [
    ...secrets.written.map((slot): AuditChange => ({
      field: "secret",
      key: slotLabel(slot, previous, next),
      before: secrets.stored.has(slot) ? { kind: "secret_set" } : null,
      after: secrets.stored.has(slot)
        ? { kind: "changed" }
        : { kind: "secret_set" },
    })),
    ...secrets.deleted.map((slot): AuditChange => ({
      field: "secret",
      key: slotLabel(slot, previous, next),
      before: { kind: "secret_set" },
      after: null,
    })),
  ];
}

/** One action per Edit (P-03): secret-only edits get the secret actions. */
export function editAuditAction(
  configChanged: boolean,
  secrets: SecretSlotChanges,
):
  | "organization.monitor.update"
  | "organization.monitor.secret.set"
  | "organization.monitor.secret.replace" {
  if (configChanged || secrets.written.length === 0) {
    return "organization.monitor.update";
  }
  return secrets.written.some((slot) => secrets.stored.has(slot))
    ? "organization.monitor.secret.replace"
    : "organization.monitor.secret.set";
}

const DENIAL_CODES = new Set(["MEMBERSHIP_DENIED", "PERMISSION_DENIED"]);

// Logs actor and action only, never the organization, monitor id, URL or input.
export async function auditMonitorDenials<T>(
  logger: Logger,
  actorUserId: string,
  action: MonitorDenialAction,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError && DENIAL_CODES.has(error.code)) {
      logger.warn(
        { actorUserId, action, code: error.code },
        "organization access denied",
      );
    }
    throw error;
  }
}
