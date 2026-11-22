import type { InventoryImportReason } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import {
  planImport,
  type ExistingRow,
  type ExistingSystem,
  type PlanRow,
} from "./import-plan";
import { identityKey, validateRow } from "./rows";

const keyOf = (vendor: string, product: string, version: string) =>
  [vendor, product, version]
    .map((part) => part.trim().toLowerCase())
    .join("\x01");

type Fields = Partial<
  Record<
    | "System"
    | "Owner"
    | "Vendor"
    | "Product"
    | "Version"
    | "Layer"
    | "Environment"
    | "Exposure",
    string
  >
>;

// One row of the file, validated by the same rules as a row typed on the screen.
function fileRow(line: number, fields: Fields = {}): PlanRow {
  const cells = {
    System: "Billing API",
    Owner: "ทีม A",
    Vendor: "Canonical",
    Product: "Ubuntu",
    Version: "22.04.4",
    Layer: "OS",
    Environment: "Production",
    Exposure: "Internal",
    ...fields,
  };
  const row = validateRow({ line, cells });
  return { ...row, key: keyOf(row.vendor, row.product, row.version) };
}

let nextId = 0;
function stored(
  fields: Fields = {},
  usable = true,
  issues: ExistingRow["issues"] = [],
): ExistingRow {
  if (!usable && issues.length === 0)
    throw new Error("a failed row has issues");
  const row = fileRow(2, fields);
  nextId += 1;
  return {
    id: `row-${String(nextId)}`,
    systemKey: row.systemKey,
    key: row.key,
    usable,
    owner: row.owner,
    vendor: row.vendor,
    product: row.product,
    version: row.version,
    layer: row.layer,
    environment: row.environment,
    exposure: row.exposure,
    issues: usable ? [] : issues,
  };
}

const billing: ExistingSystem = { id: "system-1", name: "Billing API" };
const systems = new Map([[identityKey("Billing API"), billing]]);

const BAD_VERSION = { Version: "22.04" };
const BAD_ISSUES: ExistingRow["issues"] = [
  { column: "Version", code: "version_not_patch_level" },
];

describe("planImport merge rules (Q-17, Q-18)", () => {
  const cases: {
    name: string;
    rows: PlanRow[];
    existing: ExistingRow[];
    counts: Partial<
      Record<"added" | "updated" | "unchanged" | "skipped" | "failed", number>
    >;
    reason?: InventoryImportReason["code"];
  }[] = [
    {
      name: "a usable row with a key no row has is added",
      rows: [fileRow(2, { Version: "24.04.1" })],
      existing: [stored()],
      counts: { added: 1 },
    },
    {
      name: "a usable row whose key matches a usable row updates Owner, Layer, Environment and Exposure",
      rows: [fileRow(2, { Owner: "ทีม B", Exposure: "Isolated" })],
      existing: [stored()],
      counts: { updated: 1 },
    },
    {
      name: "a usable row that matches in key and spelling with the same values is unchanged",
      rows: [fileRow(2)],
      existing: [stored()],
      counts: { unchanged: 1 },
    },
    {
      name: "a different spelling of a key column updates the row",
      rows: [fileRow(2, { Vendor: "CANONICAL" })],
      existing: [stored()],
      counts: { updated: 1 },
    },
    {
      name: "a usable row whose key matches a failed row replaces it and makes it usable",
      rows: [fileRow(2, { Version: "22.04.4" })],
      existing: [
        stored({ Version: "22.04.4" }, false, [
          { column: "Layer", code: "not_in_list" },
        ]),
      ],
      counts: { updated: 1 },
    },
    {
      name: "a failed row whose key matches a usable row is skipped and the usable row stays",
      rows: [fileRow(2, BAD_VERSION)],
      existing: [stored(BAD_VERSION)],
      counts: { skipped: 1 },
      reason: "existing_usable",
    },
    {
      name: "a failed row whose key matches a failed row with another reason replaces it",
      rows: [fileRow(2, { ...BAD_VERSION, Owner: "ทีม B" })],
      existing: [stored(BAD_VERSION, false, BAD_ISSUES)],
      counts: { failed: 1 },
    },
    {
      name: "a failed row identical to the failed row it matches is unchanged",
      rows: [fileRow(2, BAD_VERSION)],
      existing: [stored(BAD_VERSION, false, BAD_ISSUES)],
      counts: { unchanged: 1 },
    },
    {
      name: "a failed row with no matching key is added as a failed row",
      rows: [fileRow(2, BAD_VERSION)],
      existing: [],
      counts: { failed: 1 },
    },
    {
      name: "rows that match the key shared by several rows of the System are skipped",
      rows: [fileRow(2, { Owner: "ทีม B" })],
      existing: [stored(), stored()],
      counts: { skipped: 1 },
      reason: "duplicate_in_system",
    },
    {
      name: "a row without a System name is added as a failed row of the unnamed System",
      rows: [fileRow(2, { System: "" })],
      existing: [],
      counts: { failed: 1 },
      reason: "issues",
    },
  ];

  it.each(cases)("$name", ({ rows, existing, counts, reason }) => {
    const plan = planImport(rows, existing, systems);
    expect(plan.totals).toEqual({
      added: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      ...counts,
    });
    const listed = plan.preview.rows.map((row) => row.reason.code);
    if (reason) expect(listed).toEqual([reason]);
  });

  it("uses the first of two file rows with one key and skips the later one with its line", () => {
    const plan = planImport(
      [
        fileRow(2, { Version: "24.04.1" }),
        fileRow(3, { Version: " 24.04.1 ", Owner: "ทีม B" }),
        fileRow(4, { System: "HR Portal", Version: "24.04.1" }),
      ],
      [],
      systems,
    );
    expect(plan.totals).toMatchObject({ added: 2, skipped: 1 });
    expect(plan.preview.rows).toEqual([
      expect.objectContaining({
        line: 3,
        outcome: "skipped",
        reason: { code: "duplicate_in_file", line: 2 },
      }),
    ]);
    expect(plan.adds.map((row) => row.line)).toEqual([2, 4]);
  });

  it("counts per System and creates a System the Project does not have", () => {
    const plan = planImport(
      [
        fileRow(2, { Owner: "ทีม B" }),
        fileRow(3, { System: "hr portal", Version: "24.04.1" }),
        fileRow(4, { System: " HR Portal ", Version: "22.04.4" }),
      ],
      [stored()],
      systems,
    );
    expect(plan.preview.systems).toEqual([
      {
        key: "billing api",
        name: "Billing API",
        created: false,
        added: 0,
        updated: 1,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      },
      {
        key: "hr portal",
        name: "hr portal",
        created: true,
        added: 2,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      },
    ]);
  });

  it("warns when the file adds a version of a Product the System already has", () => {
    const plan = planImport(
      [
        fileRow(2, { Version: "24.04.1" }),
        fileRow(3, { Product: "Debian", Version: "12.5.0" }),
        fileRow(4, { Version: "22.04.4", Owner: "ทีม B" }),
      ],
      [stored(), stored({ Version: "20.04.6" })],
      systems,
    );
    expect(plan.preview.warnings).toEqual([
      {
        system: "Billing API",
        vendor: "Canonical",
        product: "Ubuntu",
        newVersions: ["24.04.1"],
        existingVersions: ["20.04.6", "22.04.4"],
      },
    ]);
  });

  it("keeps a row whose System name is too long as a failed row in the System of the cut name", () => {
    const long = "A".repeat(201);
    const plan = planImport([fileRow(2, { System: long })], [], systems);
    expect(plan.totals).toMatchObject({ failed: 1, skipped: 0 });
    expect(plan.preview.systems).toEqual([
      expect.objectContaining({ name: "A".repeat(200), created: true }),
    ]);
  });

  it("replaces a failed row whose fields match but whose reason differs", () => {
    // A numeric Version cell is already rewritten by the spreadsheet; the stored row has text.
    const row = validateRow({
      line: 2,
      cells: {
        System: "Billing API",
        Owner: "ทีม A",
        Vendor: "Canonical",
        Product: "Ubuntu",
        Version: 22.04,
        Layer: "OS",
        Environment: "Production",
        Exposure: "Internal",
      },
    });
    const file = { ...row, key: keyOf(row.vendor, row.product, row.version) };
    const found = stored({ Version: "22.04" }, false, BAD_ISSUES);
    expect(file.issues).toEqual([
      { column: "Version", code: "version_not_text" },
    ]);
    const plan = planImport([file], [found], systems);
    expect(plan.totals).toMatchObject({ failed: 1, unchanged: 0 });
    expect(plan.updates).toEqual([{ id: found.id, row: file }]);
  });

  it("gives two Systems whose names are cut to the same text two entries", () => {
    const plan = planImport(
      [
        fileRow(2, { System: `${"A".repeat(200)}one` }),
        fileRow(3, { System: `${"A".repeat(200)}two` }),
      ],
      [],
      new Map(),
    );
    expect(plan.preview.systems.map((system) => system.name)).toEqual([
      "A".repeat(200),
      "A".repeat(200),
    ]);
    expect(new Set(plan.preview.systems.map((system) => system.key)).size).toBe(
      2,
    );
  });

  it("keeps rows that are not in the file out of the plan", () => {
    const plan = planImport(
      [fileRow(2)],
      [stored(), stored({ Vendor: "Red Hat" })],
      systems,
    );
    expect(plan.updates).toEqual([]);
    expect(plan.totals).toMatchObject({ unchanged: 1, added: 0 });
  });
});
