import {
  INVENTORY_COLUMNS,
  inventoryImportPreviewSchema,
  inventoryMappingListSchema,
  inventorySummarySchema,
} from "@nightwatch/api-contract";
import { withTenantUserContextRaw } from "@nightwatch/db";
import { AppError } from "@nightwatch/shared";
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
import { createImportPreview } from "./import";
import {
  GOOD,
  HEADER,
  cancelPreview,
  confirmPreview,
  importFile,
  importsPath,
  multipart,
  pendingPreview,
  previewFile,
} from "./import-test-support";

const TEMPLATE = new URL(
  "../../../../docs/templates/inventory-template.xlsx",
  import.meta.url,
);
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for inventory tests");

const line = (
  system: string,
  product: string,
  version: string,
  fields: {
    owner?: string;
    vendor?: string;
    layer?: string;
    exposure?: string;
  } = {},
) =>
  [
    system,
    fields.owner ?? "ทีม A",
    fields.vendor ?? "Canonical",
    product,
    version,
    fields.layer ?? "OS",
    "Production",
    fields.exposure ?? "Internal",
  ].join(",");
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

const SEED = csv(
  line("Billing API", "Ubuntu", "22.04.4"),
  line("Billing API", "PostgreSQL", "15.6"),
  line("Billing API", "Ubuntu", "22.04"),
  line("HR Portal", "Ubuntu", "22.04.4"),
);
// One row for each merge rule, in the order of the preview's own list.
const MERGE = csv(
  line("Billing API", "Ubuntu", "22.04.4", {
    owner: "ทีม B",
    exposure: "Isolated",
  }),
  line("Billing API", "PostgreSQL", "15.6"),
  line("Billing API", "Ubuntu", "24.04.1"),
  line("Billing API", "Ubuntu", "22.04"),
  line("Billing API", "Ubuntu", "22.04"),
  line("HR Portal", "Ubuntu", "latest"),
  line("HR Portal", "Ubuntu", "22.04.4", { layer: "Kernel" }),
  line("Batch Jobs", "Ubuntu", "22.04.4"),
  line("HR Portal", "Widget", "1.2.3", { vendor: "Acme" }),
);

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let outsider: string;

async function fresh(label: string, seed: string | null = SEED) {
  const project = await ctx.createProject(org.id, label, [
    { userId: org.users.viewer, role: "member" },
    { userId: projectAdmin, role: "admin" },
  ]);
  if (seed) {
    await importFile(ctx, org.users.owner, org.id, project, seed, "seed.csv");
  }
  return project;
}

const inventoryPath = (project: string, suffix = "") =>
  `/api/organizations/${org.id}/projects/${project}/inventory${suffix}`;

type StoredRow = {
  name: string;
  line_no: number;
  owner: string;
  vendor: string;
  product: string;
  version: string;
  layer: string;
  exposure: string;
  usable: boolean;
  revision: number;
  source_kind: string;
  source_file_name: string | null;
  changed_by: string;
  changed_at: Date;
};

async function dump(project: string) {
  return (
    await ctx.owner.sql.query<StoredRow>(
      `select s.name, r.line_no, r.owner, r.vendor, r.product, r.version, r.layer, r.exposure,
              r.usable, r.revision, r.source_kind, r.source_file_name, r.changed_by, r.changed_at
       from inventory_rows r join inventory_systems s on s.id = r.system_id
       where r.project_id = $1 order by s.name_key, r.line_no`,
      [project],
    )
  ).rows;
}

async function tally(project: string) {
  const count = async (table: string) =>
    (
      await ctx.owner.sql.query<{ n: number }>(
        `select count(*)::int as n from ${table} where project_id = $1`,
        [project],
      )
    ).rows[0]?.n;
  return {
    systems: await count("inventory_systems"),
    previews: await count("inventory_previews"),
    imports: await count("inventory_imports"),
    mappings: await count("inventory_mappings"),
    audit: (
      await ctx.owner.sql.query<{ n: number }>(
        "select count(*)::int as n from audit_events where target_id = $1",
        [project],
      )
    ).rows[0]?.n,
  };
}

const errorOf = (response: { json: unknown }) =>
  (response.json as { error: { code: string; message: string } }).error;

// The test moves a preview back in time, which is the clock moving forward: expiry compares
// `expires_at` with the database's now().
const age = (project: string, userId: string, minutes: number) =>
  ctx.owner.sql.query(
    `update inventory_previews
     set created_at = created_at - make_interval(mins => $3),
         expires_at = expires_at - make_interval(mins => $3)
     where project_id = $1 and created_by = $2`,
    [project, userId, minutes],
  );

async function rowId(project: string, product: string, version: string) {
  const found = await ctx.owner.sql.query<{ id: string; revision: number }>(
    "select id, revision from inventory_rows where project_id = $1 and product = $2 and version = $3",
    [project, product, version],
  );
  const row = found.rows[0];
  if (!row) throw new Error(`row ${product} ${version} missing`);
  return row;
}

async function systemOf(project: string, name: string) {
  const found = await ctx.owner.sql.query<{ id: string; revision: number }>(
    "select id, revision from inventory_systems where project_id = $1 and name = $2",
    [project, name],
  );
  const system = found.rows[0];
  if (!system) throw new Error(`System ${name} missing`);
  return system;
}

async function xlsx(rows: string[][]) {
  const blob = await writeXlsxFile(
    [
      {
        sheet: "Inventory",
        data: [
          INVENTORY_COLUMNS.map((value) => ({ value, type: String })),
          ...rows.map((row) => row.map((value) => ({ value, type: String }))),
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
  name: string,
) {
  const form = new FormData();
  form.append("file", new File([Uint8Array.from(bytes)], name));
  return ctx.app.request(importsPath(org.id, project), {
    method: "POST",
    headers: { "x-test-user": userId, origin: "http://localhost:5173" },
    body: form,
  });
}

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("import-a");
  otherOrg = await ctx.createOrganization("import-b");
  projectAdmin = await ctx.createUser("import-project-admin");
  outsider = await ctx.createUser("import-outsider");
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

describe("import preview", () => {
  it("shows the counts per System with the skipped and failed rows, and changes no data", async () => {
    const project = await fresh("preview");
    const before = { rows: await dump(project), tally: await tally(project) };
    const response = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      MERGE,
      "q4.csv",
    );
    expect(response.status).toBe(201);
    const preview = inventoryImportPreviewSchema.parse(response.json);
    expect(preview.fileName).toBe("q4.csv");
    expect(preview.totals).toEqual({
      added: 3,
      updated: 1,
      unchanged: 2,
      skipped: 2,
      failed: 1,
    });
    expect(preview.systems).toEqual([
      {
        key: "billing api",
        name: "Billing API",
        created: false,
        added: 1,
        updated: 1,
        unchanged: 2,
        skipped: 1,
        failed: 0,
      },
      {
        key: "hr portal",
        name: "HR Portal",
        created: false,
        added: 1,
        updated: 0,
        unchanged: 0,
        skipped: 1,
        failed: 1,
      },
      {
        key: "batch jobs",
        name: "Batch Jobs",
        created: true,
        added: 1,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      },
    ]);
    expect(
      preview.rows.map((row) => [row.line, row.outcome, row.reason.code]),
    ).toEqual([
      [6, "skipped", "duplicate_in_file"],
      [7, "failed", "issues"],
      [8, "skipped", "existing_usable"],
    ]);
    expect(preview.rows[0]?.reason).toEqual({
      code: "duplicate_in_file",
      line: 5,
    });
    expect(preview.warnings).toEqual([
      {
        system: "Billing API",
        vendor: "Canonical",
        product: "Ubuntu",
        newVersions: ["24.04.1"],
        existingVersions: ["22.04", "22.04.4"],
      },
    ]);
    expect(Date.parse(preview.expiresAt) - Date.parse(preview.createdAt)).toBe(
      30 * 60_000,
    );
    expect({ rows: await dump(project), tally: await tally(project) }).toEqual({
      rows: before.rows,
      tally: { ...before.tally, previews: 1 },
    });
  });

  it("keeps rows that share a key before the import and skips file rows that match them", async () => {
    const project = await fresh("twins", null);
    await ctx.owner.sql.query(
      `with s as (insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, 'billing api', 'Billing API', 'old.csv', 'u', 2, 2) returning id)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
          environment, exposure, usable, source_kind, source_file_name, changed_by)
       select $1, $2, s.id, n + 1, 'ทีม ' || n, 'Canonical', 'Ubuntu', '22.04.4', 'OS',
              'Production', 'Internal', true, 'import', 'old.csv', 'u'
       from s, generate_series(1, 2) n`,
      [org.id, project],
    );
    const before = await dump(project);
    const { preview, result } = await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("Billing API", "Ubuntu", "22.04.4", { owner: "ทีม C" })),
    );
    expect(preview.rows).toEqual([
      expect.objectContaining({
        outcome: "skipped",
        reason: { code: "duplicate_in_system" },
      }),
    ]);
    expect(result.totals).toMatchObject({ skipped: 1, updated: 0, added: 0 });
    expect(await dump(project)).toEqual(before);
  });

  it("keeps a row without a System name as a failed row of the unnamed System", async () => {
    const project = await fresh("unnamed", null);
    const { preview, result } = await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("", "Ubuntu", "22.04.4")),
    );
    expect(preview.totals).toMatchObject({ failed: 1, added: 0, skipped: 0 });
    expect(preview.rows[0]).toMatchObject({
      outcome: "failed",
      reason: {
        code: "issues",
        issues: [{ column: "System", code: "required" }],
      },
    });
    expect(result.systems).toMatchObject([
      { name: "", created: true, failed: 1 },
    ]);
    expect(await dump(project)).toMatchObject([
      { name: "", usable: false, source_file_name: "inventory.csv" },
    ]);
    // The same file again finds that row and changes nothing.
    const again = await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("", "Ubuntu", "22.04.4")),
    );
    expect(again.result.totals).toMatchObject({ unchanged: 1, failed: 0 });
  });

  it("rejects a file that does not match the template whole, with the existing reason and no preview", async () => {
    const project = await fresh("rejected");
    const kept = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      MERGE,
      "kept.csv",
    );
    const keptId = inventoryImportPreviewSchema.parse(kept.json).id;
    const before = await tally(project);
    const wrong = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      "System,Owner,Vendor,Product,Version,Layer,Environment,Hostname\nA,B,C,D,1.2.3,OS,Production,h\n",
      "../../draft.csv",
    );
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong)).toEqual({
      code: "INVENTORY_FILE_REJECTED",
      message:
        "ไฟล์ draft.csv ถูกปฏิเสธ ไม่มีข้อมูลใดถูกนำเข้า: ขาดคอลัมน์ Exposure และมีคอลัมน์ที่ไม่อยู่ใน template: Hostname",
      details: { reason: "columns_mismatch" },
    });
    const quote = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      `${HEADER}\n${GOOD("A").replace("Internal", '"Internal')}`,
    );
    expect(quote.status).toBe(400);
    expect(errorOf(quote).code).toBe("INVENTORY_FILE_REJECTED");
    const shipped = await previewBytes(
      org.users.owner,
      project,
      new Uint8Array(readFileSync(TEMPLATE)),
      "inventory-template.xlsx",
    );
    expect(shipped.status).toBe(400);
    expect(await shipped.json()).toMatchObject({
      error: {
        code: "INVENTORY_FILE_REJECTED",
        details: { reason: "no_rows" },
      },
    });
    expect(await tally(project)).toEqual(before);
    expect(
      (await pendingPreview(ctx, org.users.owner, org.id, project))?.id,
    ).toBe(keptId);
  });

  it("answers 413 in the error envelope for an oversized body, and 403 for another origin", async () => {
    const project = await fresh("limits", null);
    const big = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      `${HEADER}\n${"x".repeat(2 * 1024 * 1024 + 70_000)}`,
    );
    expect(big.status).toBe(413);
    expect(errorOf(big).code).toBe("INVENTORY_FILE_REJECTED");
    for (const origin of ["https://evil.example", null]) {
      const response = await ctx.app.request(importsPath(org.id, project), {
        method: "POST",
        headers: {
          "x-test-user": org.users.owner,
          "content-type": "multipart/form-data; boundary=b",
          ...(origin && { origin }),
        },
        body: "--b--\r\n",
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "ORIGIN_DENIED" },
      });
    }
    expect((await tally(project)).previews).toBe(0);
  });

  it("exports the file line of each failed row's last import, not its position in the System", async () => {
    const project = await fresh("lines", null);
    const exported = async (name: string) => {
      const system = await systemOf(project, name);
      const response = await ctx.app.request(
        inventoryPath(project, `/systems/${system.id}/rejected-rows/export`),
        { headers: { "x-test-user": org.users.owner } },
      );
      expect(response.status).toBe(200);
      const sheets = await readExcelFile(await response.blob());
      // Column 0 is the file line, column 5 the Version.
      return sheets
        .flatMap((sheet) => sheet.data.slice(1))
        .map((row) => [String(row[5]), row[0]])
        .sort();
    };
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(
        line("Sys A", "Ubuntu", "22.04.4"),
        line("Sys B", "Ubuntu", "22.04"),
        line("Sys A", "Ubuntu", "latest"),
        line("Sys B", "Ubuntu", "latest"),
      ),
      "a.csv",
    );
    expect(await exported("Sys A")).toEqual([["latest", 4]]);
    expect(await exported("Sys B")).toEqual([
      ["22.04", 3],
      ["latest", 5],
    ]);
    // A later file replaces one failed row: it shows the line of the new file.
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(
        line("Sys B", "Redis", "7.2.4"),
        line("Sys B", "Redis", "7.2.5"),
        line("Sys B", "Ubuntu", "22.04", { owner: "ทีม B" }),
      ),
      "b.csv",
    );
    expect(await exported("Sys B")).toEqual([
      ["22.04", 4],
      ["latest", 5],
    ]);
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(
        line("Sys B", "Redis", "7.2.4"),
        line("Sys B", "Ubuntu", "latest", { owner: "ทีม C" }),
      ),
      "c.csv",
    );
    expect(await exported("Sys B")).toEqual([
      ["22.04", 4],
      ["latest", 3],
    ]);
    // A row written on the screen has no file line.
    const system = await systemOf(project, "Sys B");
    const created = await ctx.call(
      org.users.owner,
      "POST",
      inventoryPath(project, "/rows"),
      {
        systemId: system.id,
        owner: "ทีม A",
        vendor: "Red Hat",
        product: "RHEL",
        version: "9.4.0",
        layer: "OS",
        environment: "Production",
        exposure: "Internal",
      },
    );
    expect(created.status).toBe(201);
    const lines = await ctx.owner.sql.query<{
      product: string;
      source_line: number | null;
    }>(
      "select product, source_line from inventory_rows where project_id = $1 and product = 'RHEL'",
      [project],
    );
    expect(lines.rows).toEqual([{ product: "RHEL", source_line: null }]);
  });

  it("no longer takes a file straight into the inventory", async () => {
    const project = await fresh("old-route", null);
    const { text, contentType } = multipart(
      csv(line("A", "Ubuntu", "22.04.4")),
    );
    const response = await ctx.call(
      org.users.owner,
      "POST",
      inventoryPath(project),
      undefined,
      { text, contentType },
    );
    expect(response.status).toBe(404);
    expect(await tally(project)).toMatchObject({ systems: 0, previews: 0 });
  });

  it("imports a file built from the template's columns and reads its values back", async () => {
    const project = await fresh("roundtrip", null);
    const bytes = await xlsx([
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
        "ทีม A",
        "PostgreSQL",
        "PostgreSQL",
        "15.6",
        "DB",
        "Production",
        "Isolated",
      ],
    ]);
    const response = await previewBytes(
      org.users.owner,
      project,
      bytes,
      "inventory-q4.xlsx",
    );
    expect(response.status).toBe(201);
    const preview = inventoryImportPreviewSchema.parse(await response.json());
    expect(preview.totals).toMatchObject({ added: 2, failed: 0, skipped: 0 });
    expect(
      (await confirmPreview(ctx, org.users.owner, org.id, project, preview.id))
        .status,
    ).toBe(200);
    expect(
      (await dump(project)).map((row) => [
        row.product,
        row.layer,
        row.exposure,
        row.source_file_name,
      ]),
    ).toEqual([
      ["Ubuntu", "OS", "Internal", "inventory-q4.xlsx"],
      ["PostgreSQL", "DB", "Isolated", "inventory-q4.xlsx"],
    ]);
  });

  it("limits previews per user and Project, and fails closed when the limiter is missing or down", async () => {
    const project = await fresh("limiter", null);
    const keys = await redis.keys(`rl:inventory-import:u:${org.users.owner}:*`);
    if (keys.length > 0) await redis.del(...keys);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push(
        (
          await previewFile(
            ctx,
            org.users.owner,
            i % 2 === 0 ? org.id : org.id.toUpperCase(),
            i % 2 === 0 ? project : project.toUpperCase(),
            csv(line("Limiter", "Ubuntu", "22.04.4")),
          )
        ).status,
      );
    }
    expect(statuses).toEqual([...Array<number>(10).fill(201), 429]);
    const before = await tally(project);
    const down = {
      consumeRateLimit: () => Promise.reject(new Error("redis down")),
      consumeRateLimits: () =>
        Promise.reject(
          new AppError(
            503,
            "RATE_LIMIT_UNAVAILABLE",
            "rate limiter is unavailable",
          ),
        ),
    };
    for (const rateLimiter of [undefined, down]) {
      await expect(
        createImportPreview(
          { database: ctx.runtime, ...(rateLimiter && { rateLimiter }) },
          {
            organizationId: org.id,
            projectId: project,
            actorUserId: org.users.owner,
          },
          {
            name: "inventory.csv",
            bytes: new TextEncoder().encode(
              csv(line("Down", "Ubuntu", "22.04.4")),
            ),
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "RATE_LIMIT_UNAVAILABLE",
      });
    }
    expect(await tally(project)).toEqual(before);
    // The quota is spent; later tests of the same person start with a fresh window.
    const spent = await redis.keys(`rl:inventory-import:*`);
    if (spent.length > 0) await redis.del(...spent);
  });
});

describe("import confirm", () => {
  it("merges by the rules, writes provenance, the import record and the audit event, and queues new products", async () => {
    const project = await fresh("confirm");
    const kept = await dump(project);
    const previewed = await previewFile(
      ctx,
      org.users.admin,
      org.id,
      project,
      MERGE,
      "q4.csv",
    );
    const preview = inventoryImportPreviewSchema.parse(previewed.json);
    const confirmed = await confirmPreview(
      ctx,
      org.users.admin,
      org.id,
      project,
      preview.id,
    );
    expect(confirmed.status).toBe(200);
    const result = confirmed.json as {
      totals: unknown;
      systems: { id: string; name: string; created: boolean }[];
    };
    expect(result.totals).toEqual(preview.totals);
    expect(result.systems.map(({ name, created }) => [name, created])).toEqual([
      ["Billing API", false],
      ["HR Portal", false],
      ["Batch Jobs", true],
    ]);

    const rows = await dump(project);
    const by = (name: string, product: string, version: string) =>
      rows.find(
        (row) =>
          row.name === name &&
          row.product === product &&
          row.version === version,
      );
    // Updated: the four columns and the provenance of the import, a new revision.
    expect(by("Billing API", "Ubuntu", "22.04.4")).toMatchObject({
      owner: "ทีม B",
      exposure: "Isolated",
      revision: 2,
      source_kind: "import",
      source_file_name: "q4.csv",
      changed_by: org.users.admin,
    });
    const keptAt = (product: string, version: string) =>
      kept.find(
        (row) =>
          row.name === "Billing API" &&
          row.product === product &&
          row.version === version,
      )?.changed_at;
    expect(
      by("Billing API", "Ubuntu", "22.04.4")?.changed_at.getTime(),
    ).toBeGreaterThan(keptAt("Ubuntu", "22.04.4")?.getTime() ?? Infinity);
    // Unchanged rows keep the revision, the time and the provenance they had.
    expect(by("Billing API", "PostgreSQL", "15.6")?.changed_at).toEqual(
      keptAt("PostgreSQL", "15.6"),
    );
    for (const [product, version] of [
      ["PostgreSQL", "15.6"],
      ["Ubuntu", "22.04"],
    ] as const) {
      expect(by("Billing API", product, version)).toMatchObject({
        revision: 1,
        source_file_name: "seed.csv",
        changed_by: org.users.owner,
      });
    }
    // Added rows follow the System's last line, and a failed row is kept as a failed row.
    expect(by("Billing API", "Ubuntu", "24.04.1")).toMatchObject({
      line_no: 5,
      usable: true,
      source_file_name: "q4.csv",
      changed_by: org.users.admin,
    });
    expect(by("HR Portal", "Ubuntu", "latest")).toMatchObject({
      usable: false,
      source_file_name: "q4.csv",
    });
    expect(by("Batch Jobs", "Ubuntu", "22.04.4")).toMatchObject({
      source_file_name: "q4.csv",
    });
    // The skipped rows changed nothing: the usable HR row is as seeded.
    expect(by("HR Portal", "Ubuntu", "22.04.4")).toEqual(
      kept.find((row) => row.name === "HR Portal"),
    );
    expect(rows).toHaveLength(kept.length + 4);

    const summary = inventorySummarySchema.parse(
      (await ctx.call(org.users.owner, "GET", inventoryPath(project))).json,
    );
    expect(summary).toMatchObject({
      systemCount: 3,
      totalRows: 8,
      usableRows: 6,
      lastUploadFileName: "q4.csv",
    });
    expect(
      summary.systems.find((system) => system.name === "Billing API"),
    ).toMatchObject({
      totalRows: 4,
      usableRows: 3,
      lowQuality: true,
    });

    const mappings = inventoryMappingListSchema.parse(
      (
        await ctx.call(
          org.users.owner,
          "GET",
          inventoryPath(project, "/mappings"),
        )
      ).json,
    );
    expect(
      mappings.items.find((item) => item.product === "Widget"),
    ).toMatchObject({
      vendor: "Acme",
      status: "pending",
    });

    const record = await ctx.owner.sql.query(
      "select imported_by, file_name, added, updated, unchanged, skipped, failed from inventory_imports where project_id = $1 and file_name = 'q4.csv'",
      [project],
    );
    expect(record.rows).toEqual([
      {
        imported_by: org.users.admin,
        file_name: "q4.csv",
        added: 3,
        updated: 1,
        unchanged: 2,
        skipped: 2,
        failed: 1,
      },
    ]);
    const audit = await ctx.owner.sql.query<{
      actor_user_id: string;
      target_attributes: Record<string, unknown>;
    }>(
      "select actor_user_id, target_attributes from audit_events where tenant_id = $1 and action = 'organization.project.inventory.import' and target_id = $2 and actor_user_id = $3",
      [org.id, project, org.users.admin],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.target_attributes).toMatchObject({
      added: 3,
      updated: 1,
      unchanged: 2,
      skipped: 2,
      failed: 1,
    });
    expect((await tally(project)).previews).toBe(0);
  });

  it("keeps the last-import tile on the newest of the import record and an upload from before records", async () => {
    const project = await fresh("tile", null);
    await ctx.owner.sql.query(
      `insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, uploaded_at, total_rows, usable_rows)
       values ($1, $2, 'legacy', 'Legacy', 'legacy-q3.xlsx', 'u', now() - interval '1 day', 0, 0)`,
      [org.id, project],
    );
    const tile = async () =>
      inventorySummarySchema.parse(
        (await ctx.call(org.users.owner, "GET", inventoryPath(project))).json,
      ).lastUploadFileName;
    expect(await tile()).toBe("legacy-q3.xlsx");
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("Legacy", "Ubuntu", "22.04.4")),
      "second.csv",
    );
    expect(await tile()).toBe("second.csv");
    // A file that changes nothing is still the last import.
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("Legacy", "Ubuntu", "22.04.4")),
      "no-op.csv",
    );
    expect(await tile()).toBe("no-op.csv");
  });

  it.each([
    {
      name: "a row edited",
      change: async (project: string) => {
        const row = await rowId(project, "PostgreSQL", "15.6");
        return ctx.call(
          org.users.owner,
          "PUT",
          inventoryPath(project, `/rows/${row.id}`),
          {
            owner: "ทีม Z",
            vendor: "Canonical",
            product: "PostgreSQL",
            version: "15.6",
            layer: "DB",
            environment: "Production",
            exposure: "Internal",
            revision: row.revision,
          },
        );
      },
    },
    {
      name: "a row deleted",
      change: async (project: string) => {
        const row = await rowId(project, "PostgreSQL", "15.6");
        return ctx.call(
          org.users.owner,
          "DELETE",
          inventoryPath(
            project,
            `/rows/${row.id}?revision=${String(row.revision)}`,
          ),
        );
      },
    },
    {
      name: "a row added",
      change: async (project: string) => {
        const system = await systemOf(project, "Billing API");
        return ctx.call(
          org.users.owner,
          "POST",
          inventoryPath(project, "/rows"),
          {
            systemId: system.id,
            owner: "ทีม A",
            vendor: "Red Hat",
            product: "RHEL",
            version: "9.4.0",
            layer: "OS",
            environment: "Production",
            exposure: "Internal",
          },
        );
      },
    },
    {
      name: "a System renamed",
      change: async (project: string) => {
        const system = await systemOf(project, "Billing API");
        return ctx.call(
          org.users.owner,
          "PATCH",
          inventoryPath(project, `/systems/${system.id}`),
          {
            name: "Billing API v2",
            revision: system.revision,
          },
        );
      },
    },
    {
      name: "a System deleted",
      change: async (project: string) => {
        const system = await systemOf(project, "Billing API");
        return ctx.call(
          org.users.owner,
          "DELETE",
          inventoryPath(
            project,
            `/systems/${system.id}?revision=${String(system.revision)}&rows=3`,
          ),
        );
      },
    },
    {
      name: "a System of the file created by someone else",
      change: (project: string) =>
        ctx.call(org.users.owner, "POST", inventoryPath(project, "/systems"), {
          name: "batch jobs",
          owner: "ทีม A",
          vendor: "Canonical",
          product: "Ubuntu",
          version: "22.04.4",
          layer: "OS",
          environment: "Production",
          exposure: "Internal",
        }),
    },
    {
      name: "another import by another maintainer",
      change: async (project: string) =>
        (
          await importFile(
            ctx,
            projectAdmin,
            org.id,
            project,
            csv(line("Billing API", "Ubuntu", "20.04.6")),
            "other.csv",
          )
        ).result,
    },
  ])(
    "is refused when $name after the preview, and merges nothing",
    async ({ change }) => {
      const project = await fresh("stale");
      const previewed = await previewFile(
        ctx,
        org.users.owner,
        org.id,
        project,
        MERGE,
        "q4.csv",
      );
      const preview = inventoryImportPreviewSchema.parse(previewed.json);
      const changed = await change(project);
      if ("status" in changed)
        expect([200, 201, 204]).toContain(changed.status);
      const before = { rows: await dump(project), tally: await tally(project) };

      const confirmed = await confirmPreview(
        ctx,
        org.users.owner,
        org.id,
        project,
        preview.id,
      );
      expect(confirmed.status).toBe(409);
      expect(errorOf(confirmed)).toMatchObject({
        code: "INVENTORY_PREVIEW_STALE",
      });
      expect({
        rows: await dump(project),
        tally: await tally(project),
      }).toEqual(before);
      // The preview stays, so the person can read it or cancel it.
      expect(
        (await pendingPreview(ctx, org.users.owner, org.id, project))?.id,
      ).toBe(preview.id);
    },
  );

  it("is not refused by a change to a System that is not in the file", async () => {
    const project = await fresh("not-stale");
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("Other", "Ubuntu", "22.04.4")),
      "other.csv",
    );
    const previewed = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("Billing API", "Ubuntu", "24.04.1")),
    );
    const other = await systemOf(project, "Other");
    expect(
      (
        await ctx.call(
          org.users.owner,
          "PATCH",
          inventoryPath(project, `/systems/${other.id}`),
          { name: "Other 2", revision: other.revision },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await confirmPreview(
          ctx,
          org.users.owner,
          org.id,
          project,
          inventoryImportPreviewSchema.parse(previewed.json).id,
        )
      ).status,
    ).toBe(200);
  });

  it("changes nothing and keeps the preview when the merge fails midway, and succeeds on retry", async () => {
    const project = await fresh("atomic");
    const preview = inventoryImportPreviewSchema.parse(
      (
        await previewFile(
          ctx,
          org.users.owner,
          org.id,
          project,
          MERGE,
          "fault.csv",
        )
      ).json,
    );
    const before = { rows: await dump(project), tally: await tally(project) };
    // The update and the new System are written before the first insert of a row.
    await ctx.owner.sql.query(`
      create function inventory_import_fault() returns trigger language plpgsql as $$
      begin raise exception 'injected fault'; end $$`);
    await ctx.owner.sql.query(`
      create trigger inventory_import_fault before insert on inventory_rows
      for each row when (new.source_file_name = 'fault.csv') execute function inventory_import_fault()`);
    try {
      const failed = await confirmPreview(
        ctx,
        org.users.owner,
        org.id,
        project,
        preview.id,
      );
      expect(failed.status).toBe(500);
      expect({
        rows: await dump(project),
        tally: await tally(project),
      }).toEqual(before);
      expect(
        (await pendingPreview(ctx, org.users.owner, org.id, project))?.id,
      ).toBe(preview.id);
    } finally {
      await ctx.owner.sql.query(
        "drop trigger inventory_import_fault on inventory_rows",
      );
      await ctx.owner.sql.query("drop function inventory_import_fault()");
    }
    expect(
      (await confirmPreview(ctx, org.users.owner, org.id, project, preview.id))
        .status,
    ).toBe(200);
    expect((await tally(project)).imports).toBe(2);
  });

  it("applies once when the same preview is confirmed twice at the same time", async () => {
    const project = await fresh("double");
    const preview = inventoryImportPreviewSchema.parse(
      (
        await previewFile(
          ctx,
          org.users.owner,
          org.id,
          project,
          MERGE,
          "q4.csv",
        )
      ).json,
    );
    const outcomes = await Promise.all([
      confirmPreview(ctx, org.users.owner, org.id, project, preview.id),
      confirmPreview(ctx, org.users.owner, org.id, project, preview.id),
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([
      200, 404,
    ]);
    expect((await tally(project)).imports).toBe(2);
    expect(await dump(project)).toHaveLength(8);
  });
});

describe("import preview privacy, replacement and expiry (Q-19)", () => {
  it("is visible, confirmable and cancellable only by the person who made it", async () => {
    const project = await fresh("private");
    const preview = inventoryImportPreviewSchema.parse(
      (
        await previewFile(
          ctx,
          org.users.owner,
          org.id,
          project,
          MERGE,
          "mine.csv",
        )
      ).json,
    );
    for (const other of [projectAdmin, org.users.admin]) {
      expect(await pendingPreview(ctx, other, org.id, project)).toBeNull();
      const confirmed = await confirmPreview(
        ctx,
        other,
        org.id,
        project,
        preview.id,
      );
      expect(confirmed.status).toBe(404);
      expect(errorOf(confirmed).code).toBe("INVENTORY_PREVIEW_NOT_FOUND");
      expect(
        (await cancelPreview(ctx, other, org.id, project, preview.id)).status,
      ).toBe(404);
    }
    expect(
      (await pendingPreview(ctx, org.users.owner, org.id, project))?.id,
    ).toBe(preview.id);
    // The database policy holds without the API: another user context sees no row.
    const visible = (userId: string) =>
      withTenantUserContextRaw(
        ctx.runtime,
        org.id,
        userId,
        async (client) =>
          (
            await client.query(
              "select id from inventory_previews where project_id = $1",
              [project],
            )
          ).rowCount,
      );
    expect(await visible(org.users.owner)).toBe(1);
    expect(await visible(projectAdmin)).toBe(0);
    await expect(
      withTenantUserContextRaw(ctx.runtime, org.id, projectAdmin, (client) =>
        client.query(
          `insert into inventory_previews (tenant_id, project_id, created_by, file_name, rows, summary, fingerprints)
           values ($1, $2, $3, 'x.csv', '[]', '{}', '{}')`,
          [org.id, project, org.users.owner],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("answers 403 to a Project member and 404 to a person outside the Project on every route", async () => {
    const project = await fresh("matrix");
    const preview = inventoryImportPreviewSchema.parse(
      (await previewFile(ctx, org.users.owner, org.id, project, MERGE)).json,
    );
    const routes = (user: string | null, organization = org.id) => [
      previewFile(ctx, user, organization, project, MERGE),
      ctx.call(user, "GET", `${importsPath(organization, project)}/current`),
      confirmPreview(ctx, user, organization, project, preview.id),
      cancelPreview(ctx, user, organization, project, preview.id),
    ];
    const before = await tally(project);
    for (const response of await Promise.all(routes(org.users.viewer))) {
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe("PERMISSION_DENIED");
    }
    for (const response of await Promise.all(routes(outsider)))
      expect(response.status).toBe(404);
    for (const response of await Promise.all(routes(otherOrg.users.owner))) {
      expect([403, 404]).toContain(response.status);
    }
    for (const response of await Promise.all(routes(null)))
      expect(response.status).toBe(401);
    expect(await tally(project)).toEqual(before);
  });

  it("holds one preview per person and Project, and a new file replaces the old one", async () => {
    const project = await fresh("one-pending", null);
    const other = await fresh("one-pending-other", null);
    const first = inventoryImportPreviewSchema.parse(
      (
        await previewFile(
          ctx,
          org.users.owner,
          org.id,
          project,
          csv(line("A", "Ubuntu", "22.04.4")),
          "first.csv",
        )
      ).json,
    );
    await previewFile(
      ctx,
      org.users.owner,
      org.id,
      other,
      csv(line("A", "Ubuntu", "22.04.4")),
    );
    await previewFile(
      ctx,
      projectAdmin,
      org.id,
      project,
      csv(line("B", "Ubuntu", "22.04.4")),
      "theirs.csv",
    );
    const second = inventoryImportPreviewSchema.parse(
      (
        await previewFile(
          ctx,
          org.users.owner,
          org.id,
          project,
          csv(line("C", "Ubuntu", "22.04.4")),
          "second.csv",
        )
      ).json,
    );
    expect((await tally(project)).previews).toBe(2);
    expect(
      (await pendingPreview(ctx, org.users.owner, org.id, project))?.fileName,
    ).toBe("second.csv");
    expect(
      (await pendingPreview(ctx, projectAdmin, org.id, project))?.fileName,
    ).toBe("theirs.csv");
    expect((await tally(other)).previews).toBe(1);
    // A tab that still holds the replaced preview cannot confirm it.
    expect(
      (await confirmPreview(ctx, org.users.owner, org.id, project, first.id))
        .status,
    ).toBe(404);
    expect(
      (await confirmPreview(ctx, org.users.owner, org.id, project, second.id))
        .status,
    ).toBe(200);
  });

  it("is deleted at once by cancel and by confirm", async () => {
    const project = await fresh("cancel", null);
    const preview = inventoryImportPreviewSchema.parse(
      (
        await previewFile(
          ctx,
          org.users.owner,
          org.id,
          project,
          csv(line("A", "Ubuntu", "22.04.4")),
        )
      ).json,
    );
    expect(
      (await cancelPreview(ctx, org.users.owner, org.id, project, preview.id))
        .status,
    ).toBe(204);
    expect((await tally(project)).previews).toBe(0);
    expect(
      await pendingPreview(ctx, org.users.owner, org.id, project),
    ).toBeNull();
    expect(
      (await confirmPreview(ctx, org.users.owner, org.id, project, preview.id))
        .status,
    ).toBe(404);
    expect(
      (await cancelPreview(ctx, org.users.owner, org.id, project, preview.id))
        .status,
    ).toBe(404);
    const next = await importFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      csv(line("A", "Ubuntu", "22.04.4")),
    );
    expect((await tally(project)).previews).toBe(0);
    expect(next.result.totals.added).toBe(1);
  });

  it("is refused on confirm after 30 minutes, with the message to choose a new file and no data change", async () => {
    const project = await fresh("expiry");
    const preview = inventoryImportPreviewSchema.parse(
      (await previewFile(ctx, org.users.owner, org.id, project, MERGE)).json,
    );
    await age(project, org.users.owner, 29);
    expect(
      (await pendingPreview(ctx, org.users.owner, org.id, project))?.id,
    ).toBe(preview.id);
    await age(project, org.users.owner, 2);
    const before = { rows: await dump(project), tally: await tally(project) };
    expect(
      await pendingPreview(ctx, org.users.owner, org.id, project),
    ).toBeNull();
    const confirmed = await confirmPreview(
      ctx,
      org.users.owner,
      org.id,
      project,
      preview.id,
    );
    expect(confirmed.status).toBe(409);
    expect(errorOf(confirmed)).toMatchObject({
      code: "INVENTORY_PREVIEW_EXPIRED",
    });
    expect(errorOf(confirmed).message).toContain("เลือกไฟล์ใหม่");
    expect({ rows: await dump(project), tally: await tally(project) }).toEqual(
      before,
    );
    expect(
      (await cancelPreview(ctx, org.users.owner, org.id, project, preview.id))
        .status,
    ).toBe(204);
  });

  it("is refused when it expires while the confirmation waits for the Project lock", async () => {
    const project = await fresh("expiry-wait");
    const preview = inventoryImportPreviewSchema.parse(
      (await previewFile(ctx, org.users.owner, org.id, project, MERGE)).json,
    );
    await ctx.owner.sql.query(
      "update inventory_previews set expires_at = now() + interval '1500 milliseconds' where id = $1",
      [preview.id],
    );
    const before = { rows: await dump(project), tally: await tally(project) };
    const holder = await ctx.owner.sql.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from projects where id = $1 for update", [
        project,
      ]);
      const waiting = confirmPreview(
        ctx,
        org.users.owner,
        org.id,
        project,
        preview.id,
      );
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await holder.query("commit");
      const confirmed = await waiting;
      expect(confirmed.status).toBe(409);
      expect(errorOf(confirmed).code).toBe("INVENTORY_PREVIEW_EXPIRED");
    } finally {
      holder.release();
    }
    expect({ rows: await dump(project), tally: await tally(project) }).toEqual(
      before,
    );
  });

  it("goes with the Project", async () => {
    const project = await fresh("gone");
    await previewFile(ctx, org.users.owner, org.id, project, MERGE);
    expect((await tally(project)).imports).toBe(1);
    expect(
      (
        await ctx.call(
          org.users.owner,
          "DELETE",
          `/api/organizations/${org.id}/projects/${project}`,
        )
      ).status,
    ).toBe(204);
    expect(await tally(project)).toMatchObject({
      previews: 0,
      imports: 0,
      systems: 0,
    });
  });

  it("stores parsed rows and counts only, never the file", async () => {
    const project = await fresh("no-file", null);
    const text = csv(line("Billing API", "Ubuntu", "22.04.4"));
    await previewFile(
      ctx,
      org.users.owner,
      org.id,
      project,
      text,
      "canary-name.csv",
    );
    const columns = (table: string) =>
      ctx.owner.sql
        .query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_name = $1 order by column_name",
          [table],
        )
        .then((result) => result.rows.map((row) => row.column_name));
    expect(await columns("inventory_previews")).toEqual([
      "created_at",
      "created_by",
      "expires_at",
      "file_name",
      "fingerprints",
      "id",
      "project_id",
      "rows",
      "summary",
      "tenant_id",
    ]);
    expect(await columns("inventory_imports")).toEqual([
      "added",
      "failed",
      "file_name",
      "id",
      "imported_at",
      "imported_by",
      "project_id",
      "skipped",
      "tenant_id",
      "unchanged",
      "updated",
    ]);
    const stored = await ctx.owner.sql.query<{ rows: unknown[]; text: string }>(
      "select rows, (rows::text || summary::text || fingerprints::text) as text from inventory_previews where project_id = $1",
      [project],
    );
    expect(Object.keys(stored.rows[0]?.rows[0] ?? {}).sort()).toEqual([
      "environment",
      "exposure",
      "issues",
      "layer",
      "line",
      "owner",
      "product",
      "system",
      "systemKey",
      "vendor",
      "version",
    ]);
    expect(stored.rows[0]?.text).not.toContain(HEADER);
  });
});
