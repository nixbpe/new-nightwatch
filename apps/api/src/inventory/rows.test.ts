import { describe, expect, it } from "vitest";

import type { RawRow } from "./file";
import { validateRow, versionIssue } from "./rows";

function raw(overrides: Partial<RawRow["cells"]> = {}): RawRow {
  return {
    line: 7,
    cells: {
      System: "Billing API",
      Owner: "ทีม Payment",
      Vendor: "Canonical",
      Product: "Ubuntu",
      Version: "22.04.4",
      Layer: "OS",
      Environment: "Production",
      Exposure: "Internal",
      ...overrides,
    },
  };
}

describe("versionIssue", () => {
  it.each([
    ["Ubuntu", "22.04.4", null],
    ["MySQL", "8.0.36", null],
    ["Nginx", "v1.25.3", null],
    ["Ubuntu", "3.0.2-0ubuntu1.15", null],
    ["OpenSSH", "1:9.2p1-2+deb12u2", null],
    ["BIG-IP", "17.1.1.3", null],
    ["PostgreSQL", "15.6", null],
    ["PostgreSQL", "10.0", null],
    ["PostgreSQL", "9.6", "version_not_patch_level"],
    ["PostgreSQL", "9.6.24", null],
    ["PostgreSQL", "15", "version_not_patch_level"],
    ["Ubuntu", "22.04", "version_not_patch_level"],
    ["Redis", "7", "version_not_patch_level"],
    ["Nginx", "1.25.x", "version_not_patch_level"],
    ["Ubuntu", "22.04-LTS", "version_not_patch_level"],
    ["MySQL", "8.0-beta", "version_not_patch_level"],
    ["MySQL", "10.1-community", "version_not_patch_level"],
    ["Nginx", "1.25+", "version_not_patch_level"],
    ["Perl", "5.36~rc1", null],
    ["Nginx", "latest", "version_not_a_number"],
    ["Nginx", "N/A", "version_not_a_number"],
    ["Nginx", "1.2.3 beta!", "version_not_a_number"],
  ])("%s %s -> %s", (product, version, expected) => {
    expect(versionIssue(product, version)).toBe(expected);
  });
});

describe("validateRow", () => {
  it("accepts a complete row and normalizes list values and spacing", () => {
    const row = validateRow(
      raw({
        System: "  Billing   API ",
        Layer: " os ",
        Environment: "NON-PRODUCTION",
        Exposure: "internet-FACING",
      }),
    );
    expect(row).toMatchObject({
      line: 7,
      system: "Billing API",
      systemKey: "billing api",
      layer: "OS",
      environment: "Non-production",
      exposure: "Internet-facing",
      issues: [],
    });
  });

  it("reports every failing column with its own code", () => {
    const row = validateRow(
      raw({ Version: "22.04", Exposure: "public", Layer: "", Owner: null }),
    );
    expect(row.issues).toEqual([
      { column: "Owner", code: "required" },
      { column: "Layer", code: "required" },
      { column: "Exposure", code: "not_in_list" },
      { column: "Version", code: "version_not_patch_level" },
    ]);
  });

  it("flags a Version typed as a number or date instead of guessing it", () => {
    for (const Version of [15.1, new Date("2026-01-02T00:00:00Z")]) {
      expect(
        validateRow(raw({ Product: "PostgreSQL", Version })).issues,
      ).toEqual([{ column: "Version", code: "version_not_text" }]);
    }
  });

  it("flags a version written inside the Product name", () => {
    expect(validateRow(raw({ Product: "nginx 1.25.3" })).issues).toEqual([
      { column: "Product", code: "product_has_version" },
    ]);
    expect(validateRow(raw({ Product: "Windows Server 2019" })).issues).toEqual(
      [],
    );
  });

  it("truncates an overlong value and flags it", () => {
    const row = validateRow(raw({ Owner: "ก".repeat(201) }));
    expect(Array.from(row.owner)).toHaveLength(200);
    expect(row.issues).toEqual([{ column: "Owner", code: "too_long" }]);
  });

  it("keeps the System key within the 200 characters the column holds", () => {
    const row = validateRow(raw({ System: "İ".repeat(200) }));
    expect(Array.from(row.systemKey).length).toBeLessThanOrEqual(200);
  });

  it("gives two long names that lower-case alike distinct keys", () => {
    const one = validateRow(raw({ System: `${"İ".repeat(100)}one` }));
    const two = validateRow(raw({ System: `${"İ".repeat(100)}two` }));
    expect(one.systemKey).not.toBe(two.systemKey);
    expect(
      validateRow(raw({ System: `${"İ".repeat(100)}one` })).systemKey,
    ).toBe(one.systemKey);
  });

  it("keeps a hash key apart from a System named as that key", () => {
    const long = validateRow(raw({ System: `${"İ".repeat(100)}one` }));
    const typed = validateRow(raw({ System: long.systemKey }));
    expect(typed.system).toBe(long.systemKey.replace(/\p{Cc}/gu, " ").trim());
    expect(typed.systemKey).not.toBe(long.systemKey);
  });

  it("keeps a row without a System name in the empty-name group", () => {
    const row = validateRow(raw({ System: "" }));
    expect(row.systemKey).toBe("");
    expect(row.issues).toEqual([{ column: "System", code: "required" }]);
  });
});
