import { readFileSync } from "node:fs";

import { INVENTORY_MAX_FILE_BYTES } from "@nightwatch/api-contract";
import { unzipSync, zipSync } from "fflate";
import writeXlsxFile from "write-excel-file/universal";
import { describe, expect, it } from "vitest";

import { parseCsv, parseInventoryFile } from "./file";

const HEADER = "System,Owner,Vendor,Product,Version,Layer,Environment,Exposure";
const encode = (text: string) => new TextEncoder().encode(text);
const template = new URL(
  "../../../../docs/templates/inventory-template.xlsx",
  import.meta.url,
);

type Sheets = { sheet: string; rows: (string | number)[][] }[];
async function workbook(sheets: Sheets): Promise<Uint8Array> {
  const out = writeXlsxFile(
    sheets.map(({ sheet, rows }) => ({
      sheet,
      data: rows.map((row) =>
        row.map((value) =>
          typeof value === "number"
            ? { value, type: Number }
            : { value, type: String },
        ),
      ),
    })),
    {},
  );
  return new Uint8Array(await (await out.toBlob()).arrayBuffer());
}

describe("parseCsv", () => {
  it("reads quoted commas, doubled quotes, line breaks and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""e""",f\r\n"g\nh",,x\r\n')).toEqual([
      ["a", "b,c", 'd "e"', "f"],
      ["g\nh", "", "x"],
    ]);
  });

  it("drops a leading byte order mark", () => {
    expect(parseCsv("﻿System,Owner")).toEqual([["System", "Owner"]]);
  });
});

describe("parseInventoryFile for .csv", () => {
  it("maps columns by name ignoring case, padding and order and skips blank rows", async () => {
    const csv =
      "﻿ Exposure ,version,LAYER,environment,product,vendor,owner,system\r\n" +
      "Internal,22.04.4,os,production,Ubuntu,Canonical,ทีม A,Billing API\r\n" +
      ",,,,,,,\r\n" +
      "Isolated,15.6,db,production,PostgreSQL,PostgreSQL,ทีม A,Billing API\r\n";
    const parsed = await parseInventoryFile("inv.CSV", encode(csv));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.rows.map((row) => row.line)).toEqual([2, 4]);
    expect(parsed.rows[0]?.cells).toMatchObject({
      System: "Billing API",
      Owner: "ทีม A",
      Version: "22.04.4",
      Exposure: "Internal",
    });
  });

  it("rejects the whole file naming the missing and the extra columns", async () => {
    const csv =
      "System,Owner,Vendor,Product,Version,Layer,Environment,Hostname\nA,B,C,D,1.2.3,OS,Production,h\n";
    expect(await parseInventoryFile("inv.csv", encode(csv))).toEqual({
      ok: false,
      rejection: {
        code: "columns_mismatch",
        missing: ["Exposure"],
        unexpected: ["Hostname"],
      },
    });
  });

  it("rejects a duplicated column and a nameless column that holds data", async () => {
    const duplicate = `${HEADER},system\nA,B,C,D,1.2.3,OS,Production,Internal,x\n`;
    expect(
      await parseInventoryFile("inv.csv", encode(duplicate)),
    ).toMatchObject({
      ok: false,
      rejection: { code: "columns_mismatch", unexpected: ["system"] },
    });
    const nameless = `${HEADER},\nA,B,C,D,1.2.3,OS,Production,Internal,x\n`;
    expect(await parseInventoryFile("inv.csv", encode(nameless))).toMatchObject(
      {
        ok: false,
        rejection: { unexpected: ["(ไม่มีชื่อ)"] },
      },
    );
  });

  it("ignores a trailing empty column", async () => {
    const csv = `${HEADER},\nA,B,C,D,1.2.3,OS,Production,Internal,\n`;
    expect(await parseInventoryFile("inv.csv", encode(csv))).toMatchObject({
      ok: true,
    });
  });

  it("rejects bytes that are not UTF-8", async () => {
    const tis620 = Uint8Array.from([0x53, 0x79, 0x73, 0xb7, 0xd5, 0x2c]);
    expect(await parseInventoryFile("inv.csv", tis620)).toEqual({
      ok: false,
      rejection: { code: "csv_not_utf8" },
    });
  });

  it("rejects an empty sheet, an unsupported extension and an oversized file", async () => {
    expect(await parseInventoryFile("inv.csv", encode(`${HEADER}\n`))).toEqual({
      ok: false,
      rejection: { code: "no_rows" },
    });
    expect(await parseInventoryFile("inv.xls", encode(HEADER))).toEqual({
      ok: false,
      rejection: { code: "unsupported_extension" },
    });
    expect(
      await parseInventoryFile(
        "inv.csv",
        new Uint8Array(INVENTORY_MAX_FILE_BYTES + 1),
      ),
    ).toEqual({ ok: false, rejection: { code: "file_too_large" } });
  });

  it("rejects more rows than the limit", async () => {
    const rows = Array.from(
      { length: 5001 },
      () => "A,B,C,D,1.2.3,OS,Production,Internal",
    );
    const parsed = await parseInventoryFile(
      "inv.csv",
      encode([HEADER, ...rows].join("\n")),
    );
    expect(parsed).toEqual({ ok: false, rejection: { code: "too_many_rows" } });
  });
});

describe("parseInventoryFile for .xlsx", () => {
  const columns = HEADER.split(",");
  const dataRow = ["A", "B", "C", "D", "1.2.3", "OS", "Production", "Internal"];

  it("reads the Inventory sheet, not the first one", async () => {
    const bytes = await workbook([
      { sheet: "Guide", rows: [["note"]] },
      { sheet: "Inventory", rows: [columns, dataRow] },
    ]);
    const parsed = await parseInventoryFile("inv.xlsx", bytes);
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) expect(parsed.rows[0]?.cells.System).toBe("A");
  });

  it("reads a single sheet that is not named Inventory", async () => {
    const bytes = await workbook([
      { sheet: "Sheet1", rows: [columns, dataRow] },
    ]);
    expect(await parseInventoryFile("inv.xlsx", bytes)).toMatchObject({
      ok: true,
    });
  });

  it("rejects several sheets when none is named Inventory", async () => {
    const bytes = await workbook([
      { sheet: "One", rows: [columns, dataRow] },
      { sheet: "Two", rows: [columns, dataRow] },
    ]);
    expect(await parseInventoryFile("inv.xlsx", bytes)).toEqual({
      ok: false,
      rejection: { code: "sheet_not_found" },
    });
  });

  it("keeps a numeric Version cell as a number so the row can be flagged", async () => {
    const bytes = await workbook([
      {
        sheet: "Inventory",
        rows: [
          columns,
          ["A", "B", "C", "D", 15.1, "DB", "Production", "Internal"],
        ],
      },
    ]);
    const parsed = await parseInventoryFile("inv.xlsx", bytes);
    if (!parsed.ok) throw new Error("expected rows");
    expect(parsed.rows[0]?.cells.Version).toBe(15.1);
  });

  it("accepts the shipped template and reports it has no rows", async () => {
    const parsed = await parseInventoryFile(
      "inventory-template.xlsx",
      new Uint8Array(readFileSync(template)),
    );
    expect(parsed).toEqual({ ok: false, rejection: { code: "no_rows" } });
  });

  it("rejects bytes that are not a workbook", async () => {
    expect(await parseInventoryFile("inv.xlsx", encode("not a zip"))).toEqual({
      ok: false,
      rejection: { code: "xlsx_unreadable" },
    });
  });
});

describe("resource limits", () => {
  const zipWith = (parts: Record<string, Uint8Array>) => zipSync(parts);

  async function withSheet(edit: (xml: string) => string) {
    const valid = await workbook([
      {
        sheet: "Inventory",
        rows: [
          HEADER.split(","),
          ["A", "B", "C", "D", "1.2.3", "OS", "Production", "Internal"],
        ],
      },
    ]);
    const parts = unzipSync(valid);
    const name = Object.keys(parts).find((part) =>
      part.includes("worksheets/sheet1"),
    );
    if (!name || !parts[name]) throw new Error("sheet part missing");
    parts[name] = encode(edit(new TextDecoder().decode(parts[name])));
    return zipSync(parts);
  }

  it("reads the valid workbook the cases below are derived from", async () => {
    const bytes = await withSheet((xml) => xml);
    expect(await parseInventoryFile("inv.xlsx", bytes)).toMatchObject({
      ok: true,
    });
  });

  it("keeps reading a workbook whose rows carry an Excel-style prefixed attribute", async () => {
    const bytes = await withSheet((xml) =>
      xml.replace(/<row r="2"/, '<row r="2" x14ac:dyDescent="0.25"'),
    );
    expect(await parseInventoryFile("inv.xlsx", bytes)).toMatchObject({
      ok: true,
    });
  });

  it("scans past a far reference that only sits inside a comment", async () => {
    const bytes = await withSheet((xml) =>
      xml.replace("<sheetData>", '<!-- <row r="4000000000"> --><sheetData>'),
    );
    expect(await parseInventoryFile("inv.xlsx", bytes)).toMatchObject({
      ok: true,
    });
  });

  it.each([
    [
      "a far row number",
      (xml: string) => xml.replace(/<row r="2"/, '<row r="4000000000"'),
    ],
    [
      "a far cell row",
      (xml: string) => xml.replace(/ r="A2"/, ' r="A2147483647"'),
    ],
    ["a far column", (xml: string) => xml.replace(/ r="H2"/, ' r="ZZZZZZZZ2"')],
    [
      "single quotes",
      (xml: string) => xml.replace(/<row r="2"/, "<row r='4000000000'"),
    ],
    [
      "spaces around =",
      (xml: string) => xml.replace(/<row r="2"/, '<row r = "4000000000"'),
    ],
    [
      "a namespace prefix",
      (xml: string) => xml.replace(/<row r="2"/, '<x:row r="4000000000"'),
    ],
    [
      "a numeric entity",
      (xml: string) => xml.replace(/<row r="2"/, '<row r="&#52;000000000"'),
    ],
    [
      "a > inside an earlier attribute value",
      (xml: string) => xml.replace(/<row r="2"/, '<row a=">" r="4000000000"'),
    ],
    [
      "an r inside another attribute value",
      (xml: string) =>
        xml.replace(/<row r="2"/, `<row a=" r='1'" r="4000000000"`),
    ],
    [
      "a repeated r, bad one last",
      (xml: string) => xml.replace(/<row r="2"/, '<row r="1" r="4000000000"'),
    ],
    [
      "a repeated r, bad one first",
      (xml: string) => xml.replace(/<row r="2"/, '<row r="4000000000" r="1"'),
    ],
    [
      "a prefixed r",
      (xml: string) => xml.replace(/<row r="2"/, '<row x:r="4000000000"'),
    ],
    [
      "a prefixed r on a cell",
      (xml: string) => xml.replace(/ r="H2"/, ' x:r="ZZZZZZZZ2"'),
    ],
    [
      "an r with an empty prefix",
      (xml: string) => xml.replace(/<row r="2"/, '<row :r="4000000000"'),
    ],
    [
      "r then a prefixed r",
      (xml: string) => xml.replace(/<row r="2"/, '<row r="1" x:r="4000000000"'),
    ],
    [
      "a prefixed r then r",
      (xml: string) => xml.replace(/<row r="2"/, '<row x:r="4000000000" r="1"'),
    ],
    [
      "a DOCTYPE",
      (xml: string) =>
        `<!DOCTYPE x [<!ENTITY a "<row r='4000000000'/>">]>${xml}`,
    ],
    [
      "xmlns before a prefix",
      (xml: string) => xml.replace(/<row r="2"/, '<row xmlns:x:r="4000000000"'),
    ],
    [
      "a double colon after xmlns",
      (xml: string) => xml.replace(/<row r="2"/, '<row xmlns::r="4000000000"'),
    ],
    [
      "a hidden r behind spaces around =",
      (xml: string) =>
        xml.replace(/<row r="2"/, `<row a = "x r='4000000000' "`),
    ],
    [
      "attributes with no separator",
      (xml: string) =>
        xml.replace(/<row r="2"/, `<row a="1"b="x r='4000000000' "`),
    ],
    [
      "a non-breaking space as separator",
      (xml: string) => xml.replace(/<row r="2"/, '<row\u00a0r="1"'),
    ],
    [
      "an unquoted attribute",
      (xml: string) => xml.replace(/<row r="2"/, "<row r=4000000000"),
    ],
    [
      "a tag too long to be real",
      (xml: string) =>
        xml.replace(/<row r="2"/, `<row ${'a="1" '.repeat(1000)}r="2"`),
    ],
  ])("rejects an xlsx with %s without reading it", async (_name, edit) => {
    const bytes = await withSheet(edit);
    const started = performance.now();
    expect(await parseInventoryFile("inv.xlsx", bytes)).toEqual({
      ok: false,
      rejection: { code: "xlsx_unreadable" },
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("scans a sheet the workbook rels point at through an .xml.rels part", async () => {
    const valid = await workbook([
      {
        sheet: "Inventory",
        rows: [
          HEADER.split(","),
          ["A", "B", "C", "D", "1.2.3", "OS", "Production", "Internal"],
        ],
      },
    ]);
    const parts = unzipSync(valid);
    const rels = Object.keys(parts).find((part) =>
      part.endsWith("xl/_rels/workbook.xml.rels"),
    );
    if (!rels || !parts[rels]) throw new Error("workbook rels missing");
    const text = new TextDecoder().decode(parts[rels]);
    expect(text).toMatch(/Target="[^"]*sheet1\.xml"/);
    parts[rels] = encode(
      text.replace(/Target="[^"]*sheet1\.xml"/, 'Target="evil.xml.rels"'),
    );
    parts["xl/evil.xml.rels"] = encode(
      '<worksheet><sheetData><row r="4000000000"/></sheetData></worksheet>',
    );
    const started = performance.now();
    expect(await parseInventoryFile("inv.xlsx", zipSync(parts))).toEqual({
      ok: false,
      rejection: { code: "xlsx_unreadable" },
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("scans a sheet that sits under a path the library reads from the workbook rels", async () => {
    const valid = await workbook([
      {
        sheet: "Inventory",
        rows: [
          HEADER.split(","),
          ["A", "B", "C", "D", "1.2.3", "OS", "Production", "Internal"],
        ],
      },
    ]);
    const parts = unzipSync(valid);
    parts["xl/elsewhere/evil.xml"] = encode(
      '<sheetData><row r="4000000000"/></sheetData>',
    );
    expect(await parseInventoryFile("inv.xlsx", zipSync(parts))).toEqual({
      ok: false,
      rejection: { code: "xlsx_unreadable" },
    });
  });

  it.each(["<row ", "<c ", "<"])(
    "refuses a part made of %j repeated without taking quadratic time",
    async (unit) => {
      const bytes = zipSync({
        "xl/worksheets/sheet1.xml": encode(unit.repeat(400_000)),
      });
      expect(bytes.byteLength).toBeLessThan(INVENTORY_MAX_FILE_BYTES);
      const started = performance.now();
      expect(await parseInventoryFile("inv.xlsx", bytes)).toEqual({
        ok: false,
        rejection: { code: "xlsx_unreadable" },
      });
      expect(performance.now() - started).toBeLessThan(1000);
    },
  );

  it("rejects a zip with more than 200 entries", async () => {
    const parts: Record<string, Uint8Array> = {};
    for (let i = 0; i < 201; i += 1)
      parts[`part${String(i)}.xml`] = encode("x");
    expect(await parseInventoryFile("inv.xlsx", zipWith(parts))).toEqual({
      ok: false,
      rejection: { code: "xlsx_unreadable" },
    });
  });

  it("rejects a zip whose declared size is above 16 MB although it is small", async () => {
    const bytes = zipWith({ "xl/big.bin": new Uint8Array(17 * 1024 * 1024) });
    expect(bytes.byteLength).toBeLessThan(INVENTORY_MAX_FILE_BYTES);
    expect(await parseInventoryFile("inv.xlsx", bytes)).toEqual({
      ok: false,
      rejection: { code: "xlsx_unreadable" },
    });
  });

  it("answers quickly for a csv with many empty header cells and blank lines", async () => {
    const csv = `${HEADER}${",".repeat(100_000)}\n${"\n".repeat(1_800_000)}`;
    const started = performance.now();
    const parsed = await parseInventoryFile("inv.csv", encode(csv));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(parsed).toEqual({
      ok: false,
      rejection: { code: "too_many_rows" },
    });
  });

  it("answers quickly for a csv of empty records", async () => {
    const csv = `${HEADER}\n${",,,,,,,\n".repeat(200_000)}`;
    const started = performance.now();
    const parsed = await parseInventoryFile("inv.csv", encode(csv));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(parsed).toEqual({
      ok: false,
      rejection: { code: "too_many_rows" },
    });
  });

  it("finds the empty header cells of a normal csv in one pass", async () => {
    const csv = `${HEADER}${",".repeat(50_000)}\n${row("A")}\n`;
    const started = performance.now();
    expect(await parseInventoryFile("inv.csv", encode(csv))).toMatchObject({
      ok: true,
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

function row(system: string): string {
  return `${system},B,C,D,1.2.3,OS,Production,Internal`;
}
