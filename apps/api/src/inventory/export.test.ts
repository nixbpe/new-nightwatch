import { describe, expect, it } from "vitest";

import readExcelFile from "read-excel-file/universal";
import writeXlsxFile from "write-excel-file/universal";

import {
  cellsOf,
  contentDisposition,
  dateSerial,
  exportFileNames,
  type StoredRow,
} from "./export";

const NOW = new Date("2026-11-22T23:30:00.000Z");

describe("exportFileNames", () => {
  it("names a Project export from its slug and the UTC date", () => {
    expect(exportFileNames("payments", undefined, NOW)).toEqual({
      utf8: "inventory-payments-2026-11-22.xlsx",
      ascii: "inventory-payments-2026-11-22.xlsx",
    });
  });

  it("keeps letters, marks and digits of a System name and drops separators, quotes and line breaks", () => {
    const names = exportFileNames("payments", 'Billing "API"/v2\r\n..\\x', NOW);
    expect(names.utf8).toBe(
      "inventory-payments-Billing-API-v2-x-2026-11-22.xlsx",
    );
    expect(names.ascii).toBe(names.utf8);
  });

  it("keeps Thai in the UTF-8 name and gives the header an ASCII fallback", () => {
    const names = exportFileNames("payments", "ระบบ บัญชี", NOW);
    expect(names.utf8).toBe("inventory-payments-ระบบ-บัญชี-2026-11-22.xlsx");
    expect(names.ascii).toBe("inventory-payments-2026-11-22.xlsx");
    expect(contentDisposition(names)).toBe(
      `attachment; filename="inventory-payments-2026-11-22.xlsx"; filename*=UTF-8''inventory-payments-%E0%B8%A3%E0%B8%B0%E0%B8%9A%E0%B8%9A-%E0%B8%9A%E0%B8%B1%E0%B8%8D%E0%B8%8A%E0%B8%B5-2026-11-22.xlsx`,
    );
  });

  it("leaves the System out when nothing of its name is safe, and cuts a long name", () => {
    expect(exportFileNames("payments", '"/\\\r\n', NOW).utf8).toBe(
      "inventory-payments-2026-11-22.xlsx",
    );
    expect(exportFileNames("payments", "", NOW).utf8).toBe(
      "inventory-payments-2026-11-22.xlsx",
    );
    const long = exportFileNames("payments", "a".repeat(300), NOW).utf8;
    expect(long).toBe(`inventory-payments-${"a".repeat(40)}-2026-11-22.xlsx`);
  });
});

const stored = (overrides: Partial<StoredRow> = {}): StoredRow => ({
  system: "Billing API",
  owner: "ทีม A",
  vendor: "Canonical",
  product: "Ubuntu",
  version: "22.04.4",
  layer: "OS",
  environment: "Production",
  exposure: "Internal",
  issues: [],
  ...overrides,
});
const typed = { column: "Version", code: "version_not_text" } as const;

describe("cellsOf", () => {
  it("writes plain values as string cells in the template's column order", () => {
    expect(cellsOf(stored({ vendor: "=1+1" }))).toEqual([
      { value: "Billing API", type: String },
      { value: "ทีม A", type: String },
      { value: "=1+1", type: String },
      { value: "Ubuntu", type: String },
      { value: "22.04.4", type: String },
      { value: "OS", type: String },
      { value: "Production", type: String },
      { value: "Internal", type: String },
    ]);
  });

  it("writes a Version that was a number as a number, but only when it was typed", () => {
    expect(cellsOf(stored({ version: "15.1", issues: [typed] }))[4]).toEqual({
      value: 15.1,
      type: Number,
    });
    expect(cellsOf(stored({ version: "15.1" }))[4]).toEqual({
      value: "15.1",
      type: String,
    });
  });

  it("writes a Version that was a date as a date serial with a format, with or without a time", () => {
    const midnight = cellsOf(
      stored({ version: "2024-03-05T00:00:00.000Z", issues: [typed] }),
    )[4];
    expect(midnight).toMatchObject({ type: Number, format: "yyyy-mm-dd" });
    const timed = cellsOf(
      stored({ version: "2024-03-05T12:34:56.789Z", issues: [typed] }),
    )[4];
    expect(timed).toMatchObject({
      type: Number,
      format: "yyyy-mm-dd hh:mm:ss",
    });
  });

  it("puts one character over the limit on a value that was cut, and only on that column", () => {
    const cells = cellsOf(
      stored({
        product: "P".repeat(200),
        issues: [{ column: "Product", code: "too_long" }],
      }),
    );
    expect(cells[3]).toEqual({ value: `${"P".repeat(200)}…`, type: String });
    expect(cells[2]).toEqual({ value: "Canonical", type: String });
  });
});

describe("dateSerial", () => {
  it("reads back as the exact millisecond through the real writer and reader", async () => {
    const times = [
      Date.parse("2024-03-05T13:14:15.000Z"),
      Date.parse("2024-03-05T00:00:00.001Z"),
      Date.parse("2024-03-05T23:59:59.999Z"),
      Date.parse("1999-12-31T23:59:59.999Z"),
      ...Array.from(
        { length: 400 },
        (_, n) => 1_500_000_000_000 + n * 7_919_377 + (n % 1000),
      ),
    ];
    const blob = await writeXlsxFile(
      [
        {
          sheet: "Inventory",
          data: times.map((time) => [
            {
              value: dateSerial(time),
              type: Number,
              format: "yyyy-mm-dd hh:mm:ss",
            },
          ]),
        },
      ],
      {},
    ).toBlob();
    const back = (await readExcelFile(blob))[0]?.data.map((row) =>
      row[0] instanceof Date ? row[0].getTime() : row[0],
    );
    expect(back).toEqual(times);
  });
});
