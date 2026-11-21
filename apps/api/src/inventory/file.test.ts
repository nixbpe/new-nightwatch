import { readFileSync } from "node:fs";

import { INVENTORY_MAX_FILE_BYTES } from "@nightwatch/api-contract";
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
