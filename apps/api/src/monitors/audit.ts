import type {
  AuditChangeField,
  StoredAssertion,
} from "@nightwatch/api-contract";
import {
  AppError,
  buildCheckUrl,
  maskUrl,
  type Logger,
} from "@nightwatch/shared";

import type { AuditChange, AuditValue } from "../audit/record";
import type { StoredConfig } from "./record";

export type MonitorDenialAction =
  `organization.monitor.${"list" | "read" | "read-response" | "create" | "update" | "pause" | "resume" | "delete" | "test"}`;

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
  field: AuditChangeField,
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

// Entries keyed by name; a name that repeats in either list is keyed
// `name#ordinal` in both, so no duplicate is lost in the comparison.
function keyedEntries<T>(
  lists: [T[], T[]],
  nameOf: (item: T) => string,
): [Map<string, T>, Map<string, T>] {
  const repeated = new Set<string>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const item of list) {
      const name = nameOf(item);
      if (seen.has(name)) repeated.add(name);
      seen.add(name);
    }
  }
  const keyed = (list: T[]): Map<string, T> => {
    const ordinals = new Map<string, number>();
    return new Map(
      list.map((item) => {
        const name = nameOf(item);
        const ordinal = ordinals.get(name) ?? 0;
        ordinals.set(name, ordinal + 1);
        return [repeated.has(name) ? `${name}#${String(ordinal)}` : name, item];
      }),
    );
  };
  return [keyed(lists[0]), keyed(lists[1])];
}

// Entries both lists share, compared in order: a reorder or a changed count
// of equal entries leaves no per-item diff, so the list is reported as
// changed (no values). Adds and removals are reported by their own changes.
function orderChange(
  field: AuditChangeField,
  before: unknown[],
  after: unknown[],
): AuditChange[] {
  const encode = (items: unknown[]) =>
    items.map((item) => JSON.stringify(item));
  const left = encode(before);
  const right = encode(after);
  const shared = (items: string[], other: string[]) =>
    items.filter((item) => other.includes(item));
  return JSON.stringify(shared(left, right)) ===
    JSON.stringify(shared(right, left))
    ? []
    : [{ field, before: null, after: { kind: "changed" } }];
}

// Masking hides query values, so a value-only edit looks identical once masked:
// the after side then says "changed" instead of repeating the same text.
function urlChange(before: string, after: string): AuditChange[] {
  if (before === after) return [];
  const maskedBefore = maskedUrl(before);
  const maskedAfter = maskedUrl(after);
  return maskedBefore === maskedAfter
    ? [
        {
          field: "url",
          before: value(maskedBefore),
          after: { kind: "changed" },
        },
      ]
    : scalarChange("url", maskedBefore, maskedAfter);
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
    ...urlChange(previous.url, next.url),
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

  const headerChanges: AuditChange[] = [];
  const [headersBefore, headersAfter] = keyedEntries(
    [
      previous.headers.filter((header) => !header.secret),
      next.headers.filter((header) => !header.secret),
    ],
    (header) => header.name,
  );
  for (const key of new Set([
    ...headersBefore.keys(),
    ...headersAfter.keys(),
  ])) {
    const from = headersBefore.get(key)?.value ?? undefined;
    const to = headersAfter.get(key)?.value ?? undefined;
    const existed = [headersBefore.has(key), headersAfter.has(key)] as const;
    if (existed[0] && existed[1] && from === to) continue;
    headerChanges.push({
      field: "header",
      key,
      before: existed[0] ? value(from ?? "") : null,
      after: existed[1] ? value(to ?? "") : null,
    });
  }
  // A secret header keeps its slot id when renamed: names only, no value.
  for (const header of next.headers) {
    const old = previous.headers.find(
      (candidate) =>
        header.secret &&
        candidate.secret &&
        header.id !== undefined &&
        candidate.id?.toLowerCase() === header.id.toLowerCase(),
    );
    if (old && old.name !== header.name) {
      headerChanges.push({
        field: "header",
        before: value(old.name),
        after: value(header.name),
      });
    }
  }
  changes.push(
    ...(headerChanges.length > 0
      ? headerChanges
      : orderChange(
          "header",
          previous.headers.map((h) => [
            h.name,
            h.secret,
            h.secret ? null : h.value,
          ]),
          next.headers.map((h) => [
            h.name,
            h.secret,
            h.secret ? null : h.value,
          ]),
        )),
  );

  const [queryBefore, queryAfter] = keyedEntries(
    [previous.queryParams, next.queryParams],
    (param) => param.name,
  );
  const queryChanges: AuditChange[] = [];
  for (const key of new Set([...queryBefore.keys(), ...queryAfter.keys()])) {
    const from = queryBefore.get(key);
    const to = queryAfter.get(key);
    if (from !== undefined && to !== undefined && from.value === to.value) {
      continue;
    }
    queryChanges.push({
      field: "queryParam",
      key,
      before: from === undefined ? null : { kind: "masked" },
      after: to === undefined ? null : { kind: "masked" },
    });
  }
  changes.push(
    ...(queryChanges.length > 0
      ? queryChanges
      : orderChange(
          "queryParam",
          previous.queryParams.map((p) => [p.name, p.value]),
          next.queryParams.map((p) => [p.name, p.value]),
        )),
  );

  if (
    previous.bodyType !== next.bodyType ||
    previous.bodyContent !== next.bodyContent
  ) {
    changes.push({ field: "body", before: null, after: { kind: "changed" } });
  }

  const assertionsBefore = previous.assertions.map(assertionText);
  const assertionsAfter = next.assertions.map(assertionText);
  const assertionChanges: AuditChange[] = [];
  for (const text of new Set(assertionsBefore)) {
    if (!assertionsAfter.includes(text)) {
      assertionChanges.push({
        field: "assertions",
        before: value(text),
        after: null,
      });
    }
  }
  for (const text of new Set(assertionsAfter)) {
    if (!assertionsBefore.includes(text)) {
      assertionChanges.push({
        field: "assertions",
        before: null,
        after: value(text),
      });
    }
  }
  changes.push(
    ...(assertionChanges.length > 0
      ? assertionChanges
      : orderChange("assertions", assertionsBefore, assertionsAfter)),
  );

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
