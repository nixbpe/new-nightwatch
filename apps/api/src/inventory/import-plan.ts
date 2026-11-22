import type {
  InventoryImportCounts,
  InventoryImportReason,
  InventoryImportRow,
  InventoryImportSystem,
  InventoryImportWarning,
  InventoryIssue,
} from "@nightwatch/api-contract";

import { identityKey, type InventoryRow } from "./rows";

/** A row of the file with the key the database computes for it (`inventory_rows.row_key`). */
export type PlanRow = InventoryRow & { key: string };

export type ExistingRow = {
  id: string;
  systemKey: string;
  key: string;
  usable: boolean;
  owner: string;
  vendor: string;
  product: string;
  version: string;
  layer: string;
  environment: string;
  exposure: string;
  issues: InventoryIssue[];
};

export type ExistingSystem = { id: string; name: string };

export type ImportPlan = {
  totals: InventoryImportCounts;
  /** What the preview shows; it is stored with the preview. */
  preview: {
    systems: InventoryImportSystem[];
    rows: InventoryImportRow[];
    warnings: InventoryImportWarning[];
  };
  /** The key of each entry of `preview.systems`, in the same order. */
  systemKeys: string[];
  /** Rows to insert, usable or failed. */
  adds: PlanRow[];
  /** Rows to rewrite: a usable row over a matching row, or a changed failed row. */
  updates: { id: string; row: PlanRow }[];
};

const MAX_VERSIONS_SHOWN = 10;
const FIELDS = [
  "owner",
  "vendor",
  "product",
  "version",
  "layer",
  "environment",
  "exposure",
] as const;

// jsonb stores the keys of an issue in its own order, so issues are compared by their parts.
const issuesOf = (issues: InventoryIssue[]) =>
  issues.map((issue) => `${issue.column}:${issue.code}`).join("|");
const slot = (systemKey: string, key: string) => `${systemKey}\u0000${key}`;
const same = (row: PlanRow, found: ExistingRow) =>
  FIELDS.every((field) => row[field] === found[field]);

/**
 * The merge of one file into the Project's rows (Q-17, Q-18), shared by the preview and by the
 * confirmation, which plans again under the Project lock. It never deletes: a row the file does
 * not mention is not in the plan. `key` of both sides comes from the database, so the match is
 * the one the duplicate rule of the row editor uses. `systems` is keyed by the System's key.
 */
export function planImport(
  rows: PlanRow[],
  existing: ExistingRow[],
  systems: ReadonlyMap<string, ExistingSystem>,
): ImportPlan {
  const bySlot = new Map<string, ExistingRow[]>();
  for (const row of existing) {
    const key = slot(row.systemKey, row.key);
    const group = bySlot.get(key);
    if (group) group.push(row);
    else bySlot.set(key, [row]);
  }
  const firstLine = new Map<string, number>();
  const perSystem = new Map<string, InventoryImportSystem>();
  const plan: ImportPlan = {
    totals: { added: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
    preview: { systems: [], rows: [], warnings: [] },
    systemKeys: [],
    adds: [],
    updates: [],
  };
  const count = (systemKey: string, kind: keyof InventoryImportCounts) => {
    plan.totals[kind] += 1;
    const system = perSystem.get(systemKey);
    if (system) system[kind] += 1;
  };
  const list = (
    row: PlanRow,
    outcome: "skipped" | "failed",
    reason: InventoryImportReason,
  ) => {
    plan.preview.rows.push({
      line: row.line,
      system: row.system,
      vendor: row.vendor,
      product: row.product,
      version: row.version,
      outcome,
      reason,
    });
  };

  for (const row of rows) {
    // A row without a System name is a failed row of the unnamed System, and a name that is too
    // long keeps its row as a failed row in the System of the cut name, as an upload did.
    const known = systems.get(row.systemKey);
    if (!perSystem.has(row.systemKey)) {
      const entry = {
        key: row.systemKey,
        name: known?.name ?? row.system,
        created: known === undefined,
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      };
      perSystem.set(row.systemKey, entry);
      plan.preview.systems.push(entry);
      plan.systemKeys.push(row.systemKey);
    }
    const key = slot(row.systemKey, row.key);
    const earlier = firstLine.get(key);
    if (earlier !== undefined) {
      count(row.systemKey, "skipped");
      list(row, "skipped", { code: "duplicate_in_file", line: earlier });
      continue;
    }
    firstLine.set(key, row.line);
    const matches = bySlot.get(key) ?? [];
    const failed = row.issues.length > 0;
    const [found] = matches;
    if (matches.length > 1) {
      count(row.systemKey, "skipped");
      list(row, "skipped", { code: "duplicate_in_system" });
    } else if (found === undefined) {
      plan.adds.push(row);
      count(row.systemKey, failed ? "failed" : "added");
      if (failed) list(row, "failed", { code: "issues", issues: row.issues });
    } else if (failed && found.usable) {
      count(row.systemKey, "skipped");
      list(row, "skipped", { code: "existing_usable", issues: row.issues });
    } else if (
      same(row, found) &&
      found.usable === !failed &&
      issuesOf(found.issues) === issuesOf(row.issues)
    ) {
      count(row.systemKey, "unchanged");
    } else {
      plan.updates.push({ id: found.id, row });
      count(row.systemKey, failed ? "failed" : "updated");
      if (failed) list(row, "failed", { code: "issues", issues: row.issues });
    }
  }

  // The key includes Version, so a new version of a Product the System has is a new row. The
  // versions the System has are indexed once, so the cost stays linear in rows (REQ-01).
  const productOf = (systemKey: string, vendor: string, product: string) =>
    `${systemKey}\u0000${identityKey(vendor)}\u0000${identityKey(product)}`;
  const versionsOf = new Map<string, Set<string>>();
  for (const other of existing) {
    const product = productOf(other.systemKey, other.vendor, other.product);
    const versions = versionsOf.get(product);
    if (versions) versions.add(other.version);
    else versionsOf.set(product, new Set([other.version]));
  }
  const warned = new Map<string, InventoryImportWarning>();
  for (const row of plan.adds) {
    if (row.issues.length > 0) continue;
    const system = systems.get(row.systemKey);
    if (!system) continue;
    const product = productOf(row.systemKey, row.vendor, row.product);
    const versions = versionsOf.get(product);
    if (!versions) continue;
    const warning = warned.get(product) ?? {
      system: system.name,
      vendor: row.vendor,
      product: row.product,
      newVersions: [],
      existingVersions: [...versions].sort().slice(0, MAX_VERSIONS_SHOWN),
    };
    warning.newVersions.push(row.version);
    warned.set(product, warning);
  }
  plan.preview.warnings = [...warned.values()];
  return plan;
}
