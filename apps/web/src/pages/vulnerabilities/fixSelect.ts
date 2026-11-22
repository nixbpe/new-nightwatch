import type {
  NewCveItem,
  NewCveList,
  PriorityItem,
  PriorityList,
  TriagedItem,
  VulnerabilityList,
} from "@nightwatch/api-contract";

import type { FixFilters } from "./filters";

type Placed = Pick<
  PriorityItem,
  "mappingId" | "version" | "cveId" | "systemId" | "kev" | "cvssSeverity"
> & { triage: PriorityItem["triage"] };

const joinKey = (mappingId: string | null, version: string, cveId: string) =>
  `${mappingId ?? ""}|${version}|${cveId}`;

const isSevere = (severity: string | null) =>
  severity === "critical" || severity === "high";

export type FixSelection = {
  /** Ranked items that pass the filters, in the order the rule gave. */
  ranked: PriorityItem[];
  /** First-seen time of a ranked or not-affected item that is new; keyed by joinKey. */
  firstSeen: Map<string, string>;
  notAffected: TriagedItem[];
  /** New CVEs the latest scan no longer finds (only under the "new" filter). */
  gone: NewCveItem[];
  /** New CVEs whose state the latest scan cannot tell (only under the "new" filter). */
  unknown: NewCveItem[];
  /** Counts of the ranking itself, never of the filter. */
  tiles: { fix: number; kev: number; severe: number; fresh: number };
  /** Everything the new-CVE list holds, the figure the old page showed. */
  newTotal: number;
  /** Nothing to show at all before any filter is applied. */
  empty: boolean;
};

export const itemKey = (item: {
  mappingId: string | null;
  version: string;
  cveId: string;
}) => joinKey(item.mappingId, item.version, item.cveId);

/**
 * Splits the priority list and the new-CVE list by the filters. Every new-CVE entry lands in
 * exactly one place: a ranked or not-affected row it joins to (mapping, version, CVE), else the
 * group of what the scan says about it. A still-found entry with no row (the ranking comes from
 * the latest finished run, the new list from the latest run) is counted as not known.
 */
export function selectFix(
  priority: PriorityList,
  list: VulnerabilityList,
  fresh: NewCveList,
  filters: FixFilters,
): FixSelection {
  const news = new Map(fresh.items.map((item) => [itemKey(item), item]));
  const firstSeen = new Map(
    fresh.items.map((item) => [itemKey(item), item.firstSeenAt]),
  );
  const systemsOf = new Map<string, Set<string>>();
  for (const component of list.components) {
    const key = `${component.mappingId ?? ""}|${component.version}`;
    const systems = systemsOf.get(key) ?? new Set<string>();
    systems.add(component.systemId);
    systemsOf.set(key, systems);
  }
  const passes = (item: Placed) =>
    (filters.system === null || item.systemId === filters.system) &&
    (!filters.isNew || news.has(itemKey(item))) &&
    (!filters.kev || item.kev === true) &&
    (!filters.severe || isSevere(item.cvssSeverity)) &&
    (!filters.untriaged || item.triage === null);
  const placed = new Set(
    [...priority.items, ...priority.notAffected].map(itemKey),
  );
  const groupPasses = (item: NewCveItem) =>
    !filters.untriaged &&
    (filters.system === null ||
      systemsOf
        .get(`${item.mappingId}|${item.version}`)
        ?.has(filters.system) === true) &&
    (!filters.kev || item.kev === true) &&
    (!filters.severe || isSevere(item.cvssSeverity));
  const groupItems = (found: boolean | null) =>
    filters.isNew
      ? fresh.items.filter(
          (item) =>
            groupPasses(item) &&
            (found === null
              ? item.stillFound === null ||
                (item.stillFound && !placed.has(itemKey(item)))
              : item.stillFound === found),
        )
      : [];
  const ranked = priority.items.filter(passes);
  const notAffected = priority.notAffected.filter(passes);
  return {
    ranked,
    firstSeen,
    notAffected,
    gone: groupItems(false),
    unknown: groupItems(null),
    tiles: {
      fix: priority.items.length,
      kev: priority.items.filter((item) => item.kev === true).length,
      severe: priority.items.filter((item) => isSevere(item.cvssSeverity))
        .length,
      fresh: priority.items.filter((item) => news.has(itemKey(item))).length,
    },
    newTotal: fresh.items.length,
    empty: priority.items.length === 0 && priority.notAffected.length === 0,
  };
}
