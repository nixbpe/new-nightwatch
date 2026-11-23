/** The view and the Needs-fix filters live in the URL, so a link reopens the same page. */
export type View = "fix" | "systems";

export type FixFilters = {
  /** A System id; null for all Systems. */
  system: string | null;
  /** First seen in the last 30 days. */
  isNew: boolean;
  kev: boolean;
  /** Severity critical or high. */
  severe: boolean;
  /** No VEX status set yet. */
  untriaged: boolean;
};

export const NO_FILTERS: FixFilters = {
  system: null,
  isNew: false,
  kev: false,
  severe: false,
  untriaged: false,
};

export function parseView(params: URLSearchParams): View {
  return params.get("view") === "systems" ? "systems" : "fix";
}

export function parseFilters(params: URLSearchParams): FixFilters {
  return {
    system: params.get("system") || null,
    isNew: params.get("new") === "1",
    kev: params.get("kev") === "1",
    severe: params.get("severity") === "critical-high",
    untriaged: params.get("untriaged") === "1",
  };
}

export function hasFilters(filters: FixFilters): boolean {
  return (
    filters.system !== null ||
    filters.isNew ||
    filters.kev ||
    filters.severe ||
    filters.untriaged
  );
}

/** The query string for a view and filters; the default view and an unset filter leave no key. */
export function toSearch(view: View, filters: FixFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (view === "systems") {
    params.set("view", "systems");
    return params;
  }
  if (filters.system !== null) params.set("system", filters.system);
  if (filters.isNew) params.set("new", "1");
  if (filters.kev) params.set("kev", "1");
  if (filters.severe) params.set("severity", "critical-high");
  if (filters.untriaged) params.set("untriaged", "1");
  return params;
}
