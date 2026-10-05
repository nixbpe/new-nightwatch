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

// `changes[]` has no boolean member (#58 Data: `'enabled' | 'disabled'`), so a
// toggle is spelled out rather than sent as a raw boolean.
const enabledLabel = (on: boolean): "enabled" | "disabled" =>
  on ? "enabled" : "disabled";

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

// A secret header keeps its slot id across a rename, so ids pair first and
// names (case-insensitive) pair the rest.
function pairHeaders(
  previous: StoredHeader[],
  next: StoredHeader[],
): [StoredHeader | undefined, StoredHeader | undefined][] {
  const remaining = new Set(previous);
  const take = (match: (old: StoredHeader) => boolean) => {
    const found = [...remaining].find(match);
    if (found) remaining.delete(found);
    return found;
  };
  const pairs = next.map(
    (current): [StoredHeader | undefined, StoredHeader] => [
      current.id === undefined
        ? undefined
        : take((old) => old.id?.toLowerCase() === current.id?.toLowerCase()),
      current,
    ],
  );
  const paired = pairs.map(
    ([old, current]): [StoredHeader | undefined, StoredHeader] => [
      old ??
        take(
          (candidate) =>
            candidate.name.toLowerCase() === current.name.toLowerCase(),
        ),
      current,
    ],
  );
  return [
    ...paired,
    ...[...remaining].map((old): [StoredHeader, undefined] => [old, undefined]),
  ];
}

// Exact: a case-only rename still makes the stored config differ, so it must
// show in the feed.
const renamed = (old: StoredHeader, current: StoredHeader): boolean =>
  old.name !== current.name;

function headerChanges(
  previous: StoredHeader[],
  next: StoredHeader[],
): MonitorConfigChange[] {
  const changes: MonitorConfigChange[] = [];
  for (const [old, current] of pairHeaders(previous, next)) {
    const oldField = old && `headers.${old.name}`;
    const field = `headers.${(current ?? old)?.name ?? ""}`;
    // A secret label on either side keeps every value out of the feed, so the
    // value of a header that just became secret does not linger for 30 days.
    if (old?.secret === true || current?.secret === true) {
      if (old?.secret === true && current?.secret === true) {
        // Same slot: a kept or replaced value is reported by the slot diff.
        if (renamed(old, current)) {
          changes.push({ field: oldField ?? field, kind: "changed" });
          changes.push({ field, kind: "changed" });
        }
        continue;
      }
      const action = current?.secret === true ? "set" : "deleted";
      if (old && current && renamed(old, current)) {
        // The old name would otherwise vanish from the feed.
        changes.push({ field: oldField ?? field, kind: "secret", action });
        changes.push({ field, kind: "changed" });
        continue;
      }
      changes.push({ field, kind: "secret", action });
      continue;
    }
    if (old && current && renamed(old, current)) {
      changes.push(...value(oldField ?? field, old.value ?? null, null));
      changes.push(...value(field, null, current.value ?? null));
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
    ...value(
      "alerts.failureThreshold",
      previous.alerts.failureThreshold,
      next.alerts.failureThreshold,
    ),
    ...value(
      "alerts.downEnabled",
      enabledLabel(previous.alerts.downEnabled),
      enabledLabel(next.alerts.downEnabled),
    ),
    ...value(
      "alerts.sslEnabled",
      enabledLabel(previous.alerts.sslEnabled),
      enabledLabel(next.alerts.sslEnabled),
    ),
    ...value(
      "alerts.sslCautionDays",
      previous.alerts.sslCautionDays,
      next.alerts.sslCautionDays,
    ),
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
