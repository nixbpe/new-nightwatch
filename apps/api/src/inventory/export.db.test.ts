import {
  INVENTORY_COLUMNS,
  INVENTORY_MAX_ROWS,
  inventoryImportPreviewSchema,
  inventorySummarySchema,
} from "@nightwatch/api-contract";
import { strFromU8, unzipSync } from "fflate";
import type { Redis } from "ioredis";
import { readFileSync } from "node:fs";
import readExcelFile from "read-excel-file/universal";
import writeXlsxFile from "write-excel-file/universal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";
import { createRedisClient } from "../rate-limit";
import { cancelPreview, importsPath } from "./import-test-support";

const TEMPLATE = new URL(
  "../../../../docs/templates/inventory-template.xlsx",
  import.meta.url,
);
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for inventory tests");

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let outsider: string;

type Typed = string | number | Date;
const FILE_ROWS: Typed[][] = [
  // usable rows: a plain one, version strings, and text that Excel would coerce
  [
    "Billing API",
    "ทีม A",
    "Canonical",
    "Ubuntu",
    "22.04.4",
    "OS",
    "Production",
    "Internal",
  ],
  [
    "Billing API",
    "0123",
    "007",
    "1E3",
    "1.10.0",
    "DB",
    "Non-production",
    "Isolated",
  ],
  [
    "Billing API",
    "ทีม 😀 ü",
    "Müller",
    "Ünï",
    "15.10.2",
    "Runtime",
    "Production",
    "Internet-facing",
  ],
  // exactly 200 characters is a value that fits
  [
    "Billing API",
    "ทีม A",
    "V".repeat(200),
    "Ubuntu",
    "22.04.5",
    "OS",
    "Production",
    "Internal",
  ],
  // formula-looking values
  [
    "Formulas",
    "-2+3",
    '=HYPERLINK("http://x.invalid","a")',
    "+cmd|' /C calc'!A0",
    "@SUM(1,2)",
    "OS",
    "Production",
    "Internal",
  ],
  [
    "Formulas",
    "=1+1",
    "Canonical",
    "Ubuntu",
    "22.04.4",
    "OS",
    "Production",
    "Internal",
  ],
  // failed rows kept as entered
  [
    "Failing",
    "ทีม F",
    "Canonical",
    "Ubuntu",
    "latest",
    "OS",
    "Production",
    "Internal",
  ],
  [
    "Failing",
    "ทีม F",
    "Canonical",
    "Ubuntu",
    "2024-01-02",
    "Kernel",
    "Production",
    "public",
  ],
  ["Failing", "ทีม F", "", "Ubuntu", "22.04.4", "OS", "Production", "Internal"],
  // a Version the spreadsheet had typed as a number or a date
  [
    "Failing",
    "ทีม F",
    "Canonical",
    "Debian",
    15.1,
    "OS",
    "Production",
    "Internal",
  ],
  [
    "Failing",
    "ทีม F",
    "Canonical",
    "Alpine",
    new Date("2024-03-05T00:00:00.000Z"),
    "OS",
    "Production",
    "Internal",
  ],
  // a value over the limit is stored cut, with the reason
  [
    "Failing",
    "ทีม F",
    "Canonical",
    "P".repeat(230),
    "22.04.4",
    "OS",
    "Production",
    "Internal",
  ],
  // no System name
  [
    "",
    "ทีม N",
    "Canonical",
    "Ubuntu",
    "22.04.4",
    "OS",
    "Production",
    "Internal",
  ],
];

const projectPath = (project: string, organization = org.id, suffix = "") =>
  `/api/organizations/${organization}/projects/${project}/inventory${suffix}`;

async function workbook(rows: Typed[][]) {
  const cell = (value: Typed) =>
    typeof value === "number"
      ? { value, type: Number }
      : value instanceof Date
        ? { value, type: Date, format: "yyyy-mm-dd" }
        : { value, type: String };
  const blob = await writeXlsxFile(
    [
      {
        sheet: "Inventory",
        data: [
          INVENTORY_COLUMNS.map((value) => ({ value, type: String })),
          ...rows.map((row) => row.map(cell)),
        ],
      },
    ],
    {},
  ).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

function previewBytes(
  userId: string,
  project: string,
  bytes: Uint8Array,
  name = "inventory.xlsx",
) {
  const form = new FormData();
  form.append("file", new File([Uint8Array.from(bytes)], name));
  return ctx.app.request(importsPath(org.id, project), {
    method: "POST",
    headers: { "x-test-user": userId, origin: "http://localhost:5173" },
    body: form,
  });
}

async function confirmed(project: string, rows: Typed[][]) {
  const response = await previewBytes(
    org.users.owner,
    project,
    await workbook(rows),
    "seed.xlsx",
  );
  expect(response.status).toBe(201);
  const preview = inventoryImportPreviewSchema.parse(await response.json());
  const confirm = await ctx.call(
    org.users.owner,
    "POST",
    `${importsPath(org.id, project)}/${preview.id}/confirm`,
  );
  expect(confirm.status).toBe(200);
}

const exportRequest = (
  userId: string | null,
  project: string,
  systemId?: string,
  organization = org.id,
) =>
  ctx.app.request(
    projectPath(
      project,
      organization,
      systemId === undefined ? "/export" : `/systems/${systemId}/export`,
    ),
    userId === null ? {} : { headers: { "x-test-user": userId } },
  );

async function exported(project: string, systemId?: string, user?: string) {
  const response = await exportRequest(
    user ?? org.users.owner,
    project,
    systemId,
  );
  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

async function sheetsOf(bytes: Uint8Array) {
  return readExcelFile(new Blob([bytes]));
}

async function newProject(label: string) {
  return ctx.createProject(org.id, label, [
    { userId: org.users.viewer, role: "member" },
    { userId: projectAdmin, role: "admin" },
  ]);
}

async function systemIdOf(project: string, name: string) {
  const summary = inventorySummarySchema.parse(
    (await ctx.call(org.users.owner, "GET", projectPath(project))).json,
  );
  const found = summary.systems.find((system) => system.name === name);
  if (!found) throw new Error(`System ${name} missing`);
  return found.id;
}

type Stored = {
  system: string;
  owner: string;
  vendor: string;
  product: string;
  version: string;
  layer: string;
  environment: string;
  exposure: string;
  usable: boolean;
  issues: { column: string; code: string }[];
};

async function stored(project: string) {
  return (
    await ctx.owner.sql.query<Stored>(
      `select s.name as system, r.owner, r.vendor, r.product, r.version, r.layer, r.environment,
              r.exposure, r.usable, r.issues
       from inventory_rows r join inventory_systems s on s.id = r.system_id
       where r.project_id = $1 order by s.name_key, r.line_no`,
      [project],
    )
  ).rows;
}

const asCells = (row: Stored) => [
  row.system,
  row.owner,
  row.vendor,
  row.product,
  row.version,
  row.layer,
  row.environment,
  row.exposure,
];

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("export-a");
  otherOrg = await ctx.createOrganization("export-b");
  projectAdmin = await ctx.createUser("export-project-admin");
  outsider = await ctx.createUser("export-outsider");
  for (const user of [projectAdmin, outsider]) {
    await ctx.owner.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [crypto.randomUUID(), org.id, user],
    );
  }
}, 120_000);

afterAll(async () => {
  const keys = await redis.keys("rl:inventory-import:*");
  if (keys.length > 0) await redis.del(...keys);
  await ctx.close();
  redis.disconnect();
});

describe("inventory export", () => {
  it("writes the template's sheet and columns with usable and failed rows, and imports back unchanged", async () => {
    const project = await newProject("export-all");
    await confirmed(project, FILE_ROWS);
    // Rows from before the editor shared a key: a usable twin, and a failed row with the same key.
    await ctx.owner.sql.query(
      `with s as (select id from inventory_systems where project_id = $1 and name = 'Billing API'),
            top as (select max(line_no) as n from inventory_rows where project_id = $1)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
          environment, exposure, usable, issues, source_kind, source_file_name, changed_by)
       select $2, $1, s.id, top.n + k, 'ทีม twin', 'Canonical', 'Ubuntu', '22.04.4',
              case k when 1 then 'OS' else 'Kernel' end, 'Production', 'Internal', k = 1,
              case k when 1 then '[]' else '[{"column":"Layer","code":"not_in_list"}]' end::jsonb,
              'import', 'old.csv', 'u'
       from s, top, generate_series(1, 2) k`,
      [project, org.id],
    );
    const rows = await stored(project);
    expect(rows.some((row) => !row.usable)).toBe(true);
    expect(rows.some((row) => row.usable)).toBe(true);

    const { response, bytes } = await exported(project);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const sheets = await sheetsOf(bytes);
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Inventory"]);
    const [template] = await readExcelFile(
      new Blob([new Uint8Array(readFileSync(TEMPLATE))]),
    );
    const data = sheets[0]?.data ?? [];
    expect(data[0]).toEqual(template?.data[0]);
    expect(data[0]).toEqual([...INVENTORY_COLUMNS]);
    expect(data).toHaveLength(rows.length + 1);

    // Every stored value comes back as text, in the stored order. Three rows differ on purpose:
    // the Version the spreadsheet had typed as a number or a date goes back as that type, and a
    // value that was cut at 200 characters goes back one character over the limit.
    data.slice(1).forEach((cells, index) => {
      const row = rows[index];
      if (!row) throw new Error("more exported rows than stored rows");
      // A blank cell reads back as null.
      const want: unknown[] = asCells(row).map((value) =>
        value === "" ? null : value,
      );
      if (row.product === "Debian") want[4] = 15.1;
      if (row.product === "Alpine") {
        want[4] = new Date("2024-03-05T00:00:00.000Z");
      }
      if (row.product.length === 200) want[3] = `${row.product}…`;
      expect(cells).toEqual(want);
    });
    const body = data.slice(1);
    expect(body.some((cells) => cells[4] === "2024-01-02")).toBe(true);
    expect(body.some((cells) => cells[4] === "latest")).toBe(true);
    expect(body.some((cells) => cells[2] === "007")).toBe(true);

    // The real import preview over the file: nothing is added, updated or failed.
    const preview = await previewBytes(
      org.users.owner,
      project,
      bytes,
      "inventory-export.xlsx",
    );
    expect(preview.status).toBe(201);
    const parsed = inventoryImportPreviewSchema.parse(await preview.json());
    // The twin group (two usable-key rows of Billing API Ubuntu 22.04.4 with the file's own row)
    // and the file's rows that match it are skipped; every other row is unchanged.
    expect(parsed.totals).toEqual({
      added: 0,
      updated: 0,
      failed: 0,
      unchanged: rows.length - 3,
      skipped: 3,
    });
    expect(
      (await cancelPreview(ctx, org.users.owner, org.id, project, parsed.id))
        .status,
    ).toBe(204);
  });

  it("keeps formula-looking values as text cells, never formulas", async () => {
    const project = await newProject("export-formula");
    await confirmed(project, FILE_ROWS.slice(4, 6));
    const { bytes } = await exported(project);
    const sheet = strFromU8(
      unzipSync(bytes)["xl/worksheets/sheet1.xml"] ?? new Uint8Array(),
    );
    expect(sheet).not.toMatch(/<f[\s>/]/);
    const cells = [...sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>/g)];
    expect(cells).toHaveLength(8 * 3);
    for (const [, , attributes] of cells) {
      expect(attributes).toContain('t="s"');
    }
    const data = (await sheetsOf(bytes))[0]?.data ?? [];
    expect(data.flat()).toEqual(
      expect.arrayContaining([
        '=HYPERLINK("http://x.invalid","a")',
        "+cmd|' /C calc'!A0",
        "-2+3",
        "@SUM(1,2)",
        "=1+1",
      ]),
    );
    const preview = await previewBytes(org.users.owner, project, bytes);
    const parsed = inventoryImportPreviewSchema.parse(await preview.json());
    expect(parsed.totals).toMatchObject({
      added: 0,
      updated: 0,
      unchanged: 2,
    });
  });

  it("exports one System with only its own rows, and a System without rows as a header only", async () => {
    const project = await newProject("export-system");
    await confirmed(project, [
      [
        "Alpha",
        "ทีม A",
        "Canonical",
        "Ubuntu",
        "22.04.4",
        "OS",
        "Production",
        "Internal",
      ],
      [
        "Alpha",
        "ทีม A",
        "Canonical",
        "Ubuntu",
        "latest",
        "OS",
        "Production",
        "Internal",
      ],
      [
        "Beta",
        "ทีม B",
        "SECRET-VENDOR",
        "Ubuntu",
        "22.04.4",
        "OS",
        "Production",
        "Internal",
      ],
    ]);
    const alpha = await systemIdOf(project, "Alpha");
    const { response, bytes } = await exported(project, alpha);
    const data = (await sheetsOf(bytes))[0]?.data ?? [];
    expect(data.slice(1).map((cells) => cells[0])).toEqual(["Alpha", "Alpha"]);
    expect(JSON.stringify(data)).not.toContain("SECRET-VENDOR");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="inventory-[a-z0-9-]+-Alpha-\d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''inventory-/,
    );
    const preview = await previewBytes(org.users.owner, project, bytes);
    expect(
      inventoryImportPreviewSchema.parse(await preview.json()).totals,
    ).toMatchObject({ added: 0, updated: 0, failed: 0, unchanged: 2 });

    const empty = await ctx.owner.sql.query<{ id: string }>(
      `insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
       values ($1, $2, 'empty', 'Empty', 'x.csv', 'u', 0, 0) returning id`,
      [org.id, project],
    );
    const none = await exported(project, empty.rows[0]?.id);
    expect((await sheetsOf(none.bytes))[0]?.data).toEqual([
      [...INVENTORY_COLUMNS],
    ]);
  });

  it("names a Thai System by percent-encoding and falls back to an ASCII name", async () => {
    const project = await newProject("export-thai");
    await confirmed(project, [
      [
        "ระบบ บัญชี/ภาษี",
        "ทีม A",
        "Canonical",
        "Ubuntu",
        "22.04.4",
        "OS",
        "Production",
        "Internal",
      ],
    ]);
    const { response } = await exported(
      project,
      await systemIdOf(project, "ระบบ บัญชี/ภาษี"),
    );
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(
      /^attachment; filename="inventory-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.xlsx"; /,
    );
    expect(disposition).toContain(`filename*=UTF-8''inventory-`);
    expect(
      decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? ""),
    ).toMatch(/-ระบบ-บัญชี-ภาษี-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(disposition).not.toMatch(/[\r\n/\\]/);
  });

  it("exports a Project without inventory as a header only", async () => {
    const project = await newProject("export-empty");
    const { bytes } = await exported(project);
    const sheets = await sheetsOf(bytes);
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Inventory"]);
    expect(sheets[0]?.data).toEqual([[...INVENTORY_COLUMNS]]);
  });

  it("answers every actor as the other inventory reads do", async () => {
    const project = await newProject("export-access");
    await confirmed(project, FILE_ROWS.slice(0, 1));
    const system = await systemIdOf(project, "Billing API");
    const other = await newProject("export-other");
    await confirmed(other, FILE_ROWS.slice(0, 1));
    const otherSystem = await systemIdOf(other, "Billing API");
    for (const user of [org.users.owner, org.users.viewer, projectAdmin]) {
      expect((await exportRequest(user, project)).status).toBe(200);
      expect((await exportRequest(user, project, system)).status).toBe(200);
    }
    expect((await exportRequest(null, project)).status).toBe(401);
    expect((await exportRequest(null, project, system)).status).toBe(401);
    for (const suffix of [undefined, system]) {
      const hidden = await exportRequest(outsider, project, suffix);
      expect(hidden.status).toBe(404);
      const foreign = await exportRequest(
        otherOrg.users.owner,
        project,
        suffix,
      );
      expect(foreign.status).toBe(403);
    }
    // A member of another Project of the Organization cannot read this one either.
    const crossProject = await exportRequest(org.users.viewer, other, system);
    expect(crossProject.status).toBe(404);
    expect(await crossProject.json()).toMatchObject({
      error: { code: "INVENTORY_SYSTEM_NOT_FOUND" },
    });
    const own = await exportRequest(org.users.owner, other, otherSystem);
    expect(own.status).toBe(200);
  });

  it("never mixes in rows of another Project or Organization", async () => {
    const project = await newProject("export-iso-a");
    const second = await newProject("export-iso-b");
    await confirmed(project, [
      [
        "Alpha",
        "ทีม A",
        "Canonical",
        "Ubuntu",
        "22.04.4",
        "OS",
        "Production",
        "Internal",
      ],
    ]);
    await confirmed(second, [
      [
        "Alpha",
        "ทีม A",
        "LEAK-PROJECT",
        "Ubuntu",
        "22.04.4",
        "OS",
        "Production",
        "Internal",
      ],
    ]);
    const foreignProject = otherOrg.projectId;
    await ctx.owner.sql.query(
      `with s as (insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, 'alpha', 'Alpha', 'x.csv', 'u', 1, 1) returning id)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
          environment, exposure, usable, source_kind, source_file_name, changed_by)
       select $1, $2, s.id, 2, 'o', 'LEAK-ORG', 'p', '1.2.3', 'OS', 'Production', 'Internal',
              true, 'import', 'x.csv', 'u' from s`,
      [otherOrg.id, foreignProject],
    );
    const whole = await exported(project);
    const alpha = await exported(project, await systemIdOf(project, "Alpha"));
    for (const { bytes } of [whole, alpha]) {
      const text = JSON.stringify((await sheetsOf(bytes))[0]?.data);
      expect(text).not.toContain("LEAK-");
      expect(text).toContain("Canonical");
    }
  });

  it("refuses an inventory it cannot export as one importable file, without cutting it", async () => {
    const project = await newProject("export-large");
    // Distinct hash text does not compress, which is the worst case for the file's size.
    const rnd = (salt: string) =>
      [1, 2, 3, 4, 5, 6, 7]
        .map((part) => `md5(n::text || '${salt}${String(part)}')`)
        .join(" || ");
    const seed = (count: number, width: number) =>
      ctx.owner.sql.query(
        `with s as (insert into inventory_systems
           (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
           values ($1, $2, 'big', 'Big', 'x.csv', 'u', $3, 0) returning id)
         insert into inventory_rows
           (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
            environment, exposure, usable, issues, source_kind, source_file_name, changed_by)
         select $1, $2, s.id, n + 1, left(${rnd("o")}, $4),
                left(${rnd("v")}, $4), left(${rnd("p")}, $4),
                'x' || n, left(${rnd("l")}, $4),
                left(${rnd("e")}, $4), left(${rnd("x")}, $4),
                false, '[{"column":"Layer","code":"not_in_list"}]'::jsonb, 'import', 'x.csv', 'u'
         from s, generate_series(1, $3::int) n`,
        [org.id, project, count, width],
      );
    await seed(INVENTORY_MAX_ROWS + 1, 20);
    const system = await systemIdOf(project, "Big");
    for (const id of [undefined, system]) {
      const response = await exportRequest(org.users.owner, project, id);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "INVENTORY_EXPORT_TOO_LARGE" },
      });
    }
    await ctx.owner.sql.query(
      "delete from inventory_rows where project_id = $1 and line_no = $2",
      [project, INVENTORY_MAX_ROWS + 2],
    );
    const ok = await exportRequest(org.users.owner, project);
    expect(ok.status).toBe(200);
    const data = (await sheetsOf(new Uint8Array(await ok.arrayBuffer())))[0]
      ?.data;
    expect(data).toHaveLength(INVENTORY_MAX_ROWS + 1);
    // Worst case: five thousand rows of incompressible 200-character values exceed the size an
    // import accepts, so the export says so instead of writing a file the Import page refuses.
    await ctx.owner.sql.query(
      "delete from inventory_systems where project_id = $1",
      [project],
    );
    await seed(INVENTORY_MAX_ROWS, 200);
    const heavy = await exportRequest(org.users.owner, project);
    expect(heavy.status).toBe(409);
    expect(await heavy.json()).toMatchObject({
      error: { code: "INVENTORY_EXPORT_TOO_LARGE" },
    });
  }, 120_000);

  it("refuses 5000 rows whose file compresses under 2 MiB but is larger than an import unpacks", async () => {
    const project = await newProject("export-uncompressed");
    // Repetitive 200-character supplementary-plane strings, distinct per row and field: they
    // compress to a small file, while their XML is about 28 MB unpacked, over the importer's 16 MiB.
    const text = (code: number) =>
      `repeat(chr(${String(code)}), 190) || to_char(n, 'FM0000000000')`;
    await ctx.owner.sql.query(
      `with s as (insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, 'rep', 'Rep', 'x.csv', 'u', $3, 0) returning id)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
          environment, exposure, usable, issues, source_kind, source_file_name, changed_by)
       select $1, $2, s.id, n + 1, ${text(128512)}, ${text(128513)}, ${text(128514)},
              ${text(128515)}, ${text(128516)}, ${text(128517)}, ${text(128518)},
              false, '[{"column":"Layer","code":"not_in_list"}]'::jsonb, 'import', 'x.csv', 'u'
       from s, generate_series(1, $3::int) n`,
      [org.id, project, INVENTORY_MAX_ROWS],
    );
    const response = await exportRequest(org.users.owner, project);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "INVENTORY_EXPORT_TOO_LARGE" },
    });
  }, 120_000);

  describe("a System that was named after its rows failed for having no name", () => {
    const blank = (product: string) => [
      "",
      "ทีม N",
      "Canonical",
      product,
      "22.04.4",
      "OS",
      "Production",
      "Internal",
    ];
    const unchangedTotals = (n: number) => ({
      added: 0,
      updated: 0,
      failed: 0,
      unchanged: n,
      skipped: 0,
    });

    async function unnamed(label: string) {
      const project = await newProject(label);
      await confirmed(project, [blank("Ubuntu"), blank("Debian")]);
      const found = await ctx.owner.sql.query<{ id: string; revision: number }>(
        "select id, revision from inventory_systems where project_id = $1",
        [project],
      );
      const system = found.rows[0];
      if (!system) throw new Error("the unnamed System is missing");
      return { project, system };
    }

    const reimports = async (project: string, bytes: Uint8Array) =>
      inventoryImportPreviewSchema.parse(
        await (await previewBytes(org.users.owner, project, bytes)).json(),
      ).totals;

    it("exports an unnamed System as it is and imports it back unchanged", async () => {
      const { project, system } = await unnamed("export-unnamed");
      for (const id of [undefined, system.id]) {
        const { bytes } = await exported(project, id);
        const data = (await sheetsOf(bytes))[0]?.data ?? [];
        expect(data.slice(1).map((cells) => cells[0])).toEqual([null, null]);
        expect(await reimports(project, bytes)).toEqual(unchangedTotals(2));
      }
    });

    it("refuses the export, with the count, until the rows are saved again", async () => {
      const { project, system } = await unnamed("export-renamed");
      const other = await newProject("export-renamed-other");
      await confirmed(other, [blank("Ubuntu")]);
      const rename = await ctx.call(
        org.users.owner,
        "PATCH",
        projectPath(project, org.id, `/systems/${system.id}`),
        { name: "Payments API", revision: system.revision },
      );
      expect(rename.status).toBe(200);
      for (const id of [undefined, system.id]) {
        const refused = await exportRequest(org.users.owner, project, id);
        expect(refused.status).toBe(409);
        const body = (await refused.json()) as {
          error: { code: string; message: string };
        };
        expect(body.error.code).toBe("INVENTORY_EXPORT_STALE_ROWS");
        expect(body.error.message).toContain("2 แถว");
      }
      const rows = await ctx.owner.sql.query<{ id: string; revision: number }>(
        "select id, revision from inventory_rows where project_id = $1 order by line_no",
        [project],
      );
      const save = async (
        row: { id: string; revision: number },
        product: string,
      ) =>
        ctx.call(
          org.users.owner,
          "PUT",
          projectPath(project, org.id, `/rows/${row.id}`),
          {
            owner: "ทีม N",
            vendor: "Canonical",
            product,
            version: "22.04.4",
            layer: "OS",
            environment: "Production",
            exposure: "Internal",
            revision: row.revision,
          },
        );
      const [first, second] = rows.rows;
      if (!first || !second) throw new Error("the rows are missing");
      expect((await save(first, "Ubuntu")).status).toBe(200);
      const half = await exportRequest(org.users.owner, project);
      expect(half.status).toBe(409);
      expect(
        ((await half.json()) as { error: { message: string } }).error.message,
      ).toContain("1 แถว");
      expect((await save(second, "Debian")).status).toBe(200);
      const { bytes } = await exported(project);
      expect(await reimports(project, bytes)).toEqual(unchangedTotals(2));
      // The other Project's unnamed System is not touched by the rename.
      expect((await exportRequest(org.users.owner, other)).status).toBe(200);
    });
  });

  it.each([
    "00:00:00.001Z",
    "00:00:00.999Z",
    "01:02:03.000Z",
    "12:34:56.789Z",
    "13:14:15.000Z",
    "18:00:00.500Z",
    "23:59:59.999Z",
  ])(
    "gives a Version typed as a date with the time %s back unchanged through the import preview",
    async (time) => {
      const project = await newProject("export-datetime");
      const version = `2024-03-05T${time}`;
      await ctx.owner.sql.query(
        `with s as (insert into inventory_systems
           (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
           values ($1, $2, 'dates', 'Dates', 'x.xlsx', 'u', 1, 0) returning id)
         insert into inventory_rows
           (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
            environment, exposure, usable, issues, source_kind, source_file_name, changed_by)
         select $1, $2, s.id, 2, 'o', 'Canonical', 'Ubuntu', $3, 'OS', 'Production', 'Internal',
                false, '[{"column":"Version","code":"version_not_text"}]'::jsonb, 'import',
                'x.xlsx', 'u' from s`,
        [org.id, project, version],
      );
      const { bytes } = await exported(project);
      const response = await previewBytes(org.users.owner, project, bytes);
      expect(
        inventoryImportPreviewSchema.parse(await response.json()).totals,
      ).toEqual({ added: 0, updated: 0, failed: 0, unchanged: 1, skipped: 0 });
    },
  );

  it("KNOWN LIMITATION: a stored value with a character the xlsx writer strips does not match its row again", async () => {
    const project = await newProject("export-stripped");
    await ctx.owner.sql.query(
      `with s as (insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, 'stripped', 'Stripped', 'x.csv', 'u', 1, 1) returning id)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
          environment, exposure, usable, source_kind, source_file_name, changed_by)
       select $1, $2, s.id, 2, 'o', 'Can' || chr(65534) || 'onical', 'Ubuntu', '22.04.4', 'OS',
              'Production', 'Internal', true, 'import', 'x.csv', 'u' from s`,
      [org.id, project],
    );
    const { bytes } = await exported(project);
    expect((await sheetsOf(bytes))[0]?.data[1]?.[2]).toBe("Canonical");
    const response = await previewBytes(org.users.owner, project, bytes);
    expect(
      inventoryImportPreviewSchema.parse(await response.json()).totals,
    ).toEqual({ added: 1, updated: 0, failed: 0, unchanged: 0, skipped: 0 });
  });

  it("KNOWN LIMITATION: a System name over 200 characters is keyed from the uncut name", async () => {
    const project = await newProject("export-long-system");
    const name = "S".repeat(230);
    const row = [
      name,
      "ทีม A",
      "Canonical",
      "Ubuntu",
      "22.04.4",
      "OS",
      "Production",
      "Internal",
    ];
    const response = await previewBytes(
      org.users.owner,
      project,
      await workbook([row]),
    );
    expect(response.status).toBe(201);
    const first = inventoryImportPreviewSchema.parse(await response.json());
    const confirm = await ctx.call(
      org.users.owner,
      "POST",
      `${importsPath(org.id, project)}/${first.id}/confirm`,
    );
    const stored = await ctx.owner.sql.query<{ n: number; len: number }>(
      "select count(*)::int as n, max(char_length(name))::int as len from inventory_systems where project_id = $1",
      [project],
    );
    expect(confirm.status).toBe(200);
    expect(stored.rows).toEqual([{ n: 1, len: 200 }]);
    const { bytes } = await exported(project);
    const again = await previewBytes(org.users.owner, project, bytes);
    const preview = inventoryImportPreviewSchema.parse(await again.json());
    // Pinned as it is: the file starts a second System instead of matching the first.
    expect(preview.totals).toEqual({
      added: 1,
      updated: 0,
      failed: 0,
      unchanged: 0,
      skipped: 0,
    });
    expect(preview.systems.map((system) => system.created)).toEqual([true]);
  });
});
