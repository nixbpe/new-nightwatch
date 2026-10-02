import type {
  MonitorConfigChange,
  StoredHeader,
} from "@nightwatch/api-contract";
import { maskUrl } from "@nightwatch/shared";

import { canonical, type StoredConfig } from "./record";
import type { SecretPlan } from "./secrets";

const VALUE_MAX_CHARS = 200;
const MASK = "•••";

// Cut on code points: a split surrogate pair is not valid in jsonb.
function cut(value: string): string {
  const points = Array.from(value);
  return points.length <= VALUE_MAX_CHARS
    ? value
    : points.slice(0, VALUE_MAX_CHARS).join("");
}

function value(
  field: string,
  before: string | number | null,
  after: string | number | null,
): MonitorConfigChange[] {
  if (before === after) return [];
  return [
    {
      field,
      kind: "value",
      before: typeof before === "string" ? cut(before) : before,
      after: typeof after === "string" ? cut(after) : after,
    },
  ];
}

function headerMap(headers: StoredHeader[]): Map<string, StoredHeader> {
  return new Map(headers.map((header) => [header.name.toLowerCase(), header]));
}

function headerChanges(
  previous: StoredHeader[],
  next: StoredHeader[],
): MonitorConfigChange[] {
  const before = headerMap(previous);
  const after = headerMap(next);
  const changes: MonitorConfigChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(key);
    const current = after.get(key);
    const field = `headers.${(current ?? old)?.name ?? key}`;
    // A secret label on either side keeps every value out of the feed, so the
    // value of a header that just became secret does not linger for 30 days.
    if (old?.secret === true || current?.secret === true) {
      if (old?.secret === true && current?.secret === true) continue;
      changes.push({
        field,
        kind: "secret",
        action: current?.secret === true ? "set" : "deleted",
      });
      continue;
    }
    changes.push(...value(field, old?.value ?? null, current?.value ?? null));
  }
  return changes;
}

function queryParamChanges(
  previous: StoredConfig["queryParams"],
  next: StoredConfig["queryParams"],
): MonitorConfigChange[] {
  const group = (rows: StoredConfig["queryParams"]) => {
    const values = new Map<string, string[]>();
    for (const row of rows) {
      values.set(row.name, [...(values.get(row.name) ?? []), row.value]);
    }
    return values;
  };
  const before = group(previous);
  const after = group(next);
  const changes: MonitorConfigChange[] = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(name);
    const current = after.get(name);
    if (JSON.stringify(old) === JSON.stringify(current)) continue;
    changes.push({
      field: `queryParams.${cut(name)}`,
      kind: "value",
      before: old === undefined ? null : MASK,
      after: current === undefined ? null : MASK,
    });
  }
  return changes;
}

/**
 * The fields an Edit changed, shaped for the event feed (AC-42, AC-56): values
 * only where they are already visible to every reader of the config, never a
 * secret, query value, body or assertion text.
 */
export function diffConfig(
  previous: StoredConfig,
  next: StoredConfig,
  plan: SecretPlan,
  storedSlots: ReadonlySet<string>,
): MonitorConfigChange[] {
  const changes: MonitorConfigChange[] = [
    ...value("name", previous.name, next.name),
    ...value("method", previous.method, next.method),
    ...value(
      "expectedStatus",
      previous.expectedStatusText,
      next.expectedStatusText,
    ),
    ...value("auth.type", previous.authType, next.authType),
    ...value(
      "auth.headerName",
      previous.apiKeyHeaderName,
      next.apiKeyHeaderName,
    ),
  ];
  if (previous.url !== next.url) {
    const before = maskUrl(previous.url);
    const after = maskUrl(next.url);
    // Only a masked query value differs: nothing safe to show but the fact.
    changes.push(
      ...(before === after
        ? [{ field: "url", kind: "changed" } as const]
        : value("url", before, after)),
    );
  }
  changes.push(
    ...value("intervalSeconds", previous.intervalSeconds, next.intervalSeconds),
    ...value("timeoutSeconds", previous.timeoutSeconds, next.timeoutSeconds),
    ...headerChanges(previous.headers, next.headers),
    ...queryParamChanges(previous.queryParams, next.queryParams),
  );
  if (
    previous.bodyType !== next.bodyType ||
    previous.bodyContent !== next.bodyContent
  ) {
    changes.push({ field: "body", kind: "changed" });
  }
  if (canonical(previous.assertions) !== canonical(next.assertions)) {
    changes.push({ field: "assertions", kind: "changed" });
  }
  for (const { slot } of plan.writes) {
    changes.push({
      field: slot,
      kind: "secret",
      action: storedSlots.has(slot) ? "replaced" : "set",
    });
  }
  for (const slot of plan.deletes) {
    changes.push({ field: slot, kind: "secret", action: "deleted" });
  }
  return changes;
}
