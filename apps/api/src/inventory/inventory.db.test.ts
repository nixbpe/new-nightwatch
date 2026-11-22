import {
  inventoryRowListSchema,
  inventorySummarySchema,
} from "@nightwatch/api-contract";
import { createHash } from "node:crypto";

import type { Redis } from "ioredis";
import readExcelFile from "read-excel-file/universal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRedisClient } from "../rate-limit";
import { HEADER, GOOD, importFile, previewFile } from "./import-test-support";
import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for inventory tests");

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let outsider: string;
let projectId: string;

const path = (project = projectId, organization = org.id, suffix = "") =>
  `/api/organizations/${organization}/projects/${project}/inventory${suffix}`;

// Chooses the file and confirms its preview, as a person does on the Import page.
async function importCsv(
  userId: string,
  csv: string,
  fileName = "inventory.csv",
  project = projectId,
) {
  await importFile(ctx, userId, org.id, project, csv, fileName);
  const summary = await ctx.call(userId, "GET", path(project));
  expect(summary.status).toBe(200);
  return inventorySummarySchema.parse(summary.json);
}

function systemId(
  summary: { systems: { id: string; name: string }[] },
  name: string,
): string {
  const system = summary.systems.find((item) => item.name === name);
  if (!system) throw new Error(`System ${name} missing from the summary`);
  return system.id;
}

async function storedRows(project = projectId) {
  const result = await ctx.owner.sql.query<{
    name: string;
    line_no: number;
    usable: boolean;
  }>(
    `select s.name, r.line_no, r.usable from inventory_rows r
     join inventory_systems s on s.id = r.system_id
     where r.project_id = $1 order by s.name_key, r.line_no`,
    [project],
  );
  return result.rows;
}

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("inventory-a");
  otherOrg = await ctx.createOrganization("inventory-b");
  projectId = org.projectId;
  projectAdmin = await ctx.createUser("inventory-project-admin");
  outsider = await ctx.createUser("inventory-outsider");
  for (const user of [projectAdmin, outsider]) {
    await ctx.owner.sql.query(
      "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
      [crypto.randomUUID(), org.id, user],
    );
  }
  await ctx.owner.sql.query(
    "insert into project_members (project_id, tenant_id, user_id, role) values ($1, $2, $3, 'admin')",
    [projectId, org.id, projectAdmin],
  );
}, 120_000);

afterAll(async () => {
  const keys = [
    ...(await redis.keys(`rl:inventory-import:u:*:p:${projectId}`)),
    `rl:inventory-import:o:${org.id}`,
  ];
  await redis.del(...keys);
  await ctx.close();
  redis.disconnect();
});

describe("inventory after imports", () => {
  it("keeps usable and rejected rows per System and reports quality", async () => {
    const csv = [
      HEADER,
      GOOD("Billing API"),
      GOOD("Billing API", "15.6").replace("Ubuntu", "PostgreSQL"),
      GOOD("HR Portal"),
      GOOD("HR Portal", "22.04"),
      GOOD("HR Portal", "latest"),
      GOOD("HR Portal", "7").replace(
        "OS,Production,Internal",
        "Kernel,Production,Internal",
      ),
    ].join("\n");
    const summary = await importCsv(org.users.owner, csv, "inventory-q4.csv");
    expect(summary).toMatchObject({
      canUpload: true,
      systemCount: 2,
      totalRows: 6,
      usableRows: 3,
      lastUploadFileName: "inventory-q4.csv",
    });
    expect(
      summary.systems.map(
        ({ name, totalRows, usableRows, lowQuality, owners }) => ({
          name,
          totalRows,
          usableRows,
          lowQuality,
          owners,
        }),
      ),
    ).toEqual([
      {
        name: "Billing API",
        totalRows: 2,
        usableRows: 2,
        lowQuality: false,
        owners: ["ทีม A"],
      },
      {
        name: "HR Portal",
        totalRows: 4,
        usableRows: 1,
        lowQuality: true,
        owners: ["ทีม A"],
      },
    ]);

    const rejected = await ctx.call(
      org.users.viewer,
      "GET",
      path(
        projectId,
        org.id,
        `/rows?system=${systemId(summary, "HR Portal")}&status=rejected`,
      ),
    );
    expect(rejected.status).toBe(200);
    expect(
      inventoryRowListSchema.parse(rejected.json).rows.map((row) => row.issues),
    ).toEqual([
      [{ column: "Version", code: "version_not_patch_level" }],
      [{ column: "Version", code: "version_not_a_number" }],
      [
        { column: "Layer", code: "not_in_list" },
        { column: "Version", code: "version_not_patch_level" },
      ],
    ]);
  });

  it("keeps two long names that lower-case alike as two Systems, also on a later import", async () => {
    const long = "İ".repeat(100);
    const summary = await importCsv(
      org.users.owner,
      [HEADER, GOOD(`${long}one`), GOOD(`${long}two`)].join("\n"),
    );
    expect(
      summary.systems.filter((system) => system.name.startsWith(long)),
    ).toHaveLength(2);
    const after = await importCsv(
      org.users.owner,
      [HEADER, GOOD(`${long}one`, "24.04.1")].join("\n"),
    );
    expect(
      after.systems.filter((system) => system.name.startsWith(long)),
    ).toHaveLength(2);
    expect(
      (await storedRows()).filter((row) => row.name.startsWith(long)),
    ).toHaveLength(3);
  });

  it("keeps a System named like a hash key apart from the long name it hashes", async () => {
    const long = `${"İ".repeat(100)}hash`;
    const digest = createHash("sha256")
      .update(long.toLowerCase())
      .digest("hex");
    const names = (
      await importCsv(
        org.users.owner,
        [HEADER, GOOD(long), GOOD(`sha256:${digest}`)].join("\n"),
      )
    ).systems.map((system) => system.name);
    expect(names).toContain(long);
    expect(names).toContain(`sha256:${digest}`);
  });

  it("does not merge into a System when an overlong name shares its prefix", async () => {
    const project = await ctx.createProject(org.id, "long-name-identity", []);
    const prefix = "A".repeat(200);
    const first = await importCsv(
      org.users.owner,
      [HEADER, GOOD(prefix)].join("\n"),
      "inventory.csv",
      project,
    );
    const originalId = systemId(first, prefix);
    const summary = await importCsv(
      org.users.owner,
      [HEADER, GOOD(`${prefix}other`)].join("\n"),
      "inventory.csv",
      project,
    );
    expect(summary.systems).toHaveLength(2);
    expect(
      summary.systems.find((system) => system.id === originalId),
    ).toMatchObject({ name: prefix, totalRows: 1, usableRows: 1 });
    expect(await storedRows(project)).toEqual(
      expect.arrayContaining([
        { name: prefix, line_no: 2, usable: true },
        { name: prefix, line_no: 2, usable: false },
      ]),
    );
  });

  it("lets a Project admin import and shows a Project member the inventory without the right to", async () => {
    const asAdmin = await importCsv(
      projectAdmin,
      [HEADER, GOOD("Partner Portal")].join("\n"),
    );
    expect(asAdmin.canUpload).toBe(true);
    const before = await storedRows();
    const asMember = await previewFile(
      ctx,
      org.users.viewer,
      org.id,
      projectId,
      [HEADER, GOOD("Blocked")].join("\n"),
    );
    expect(asMember.status).toBe(403);
    expect(asMember.json).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    expect(await storedRows()).toEqual(before);
    const read = await ctx.call(org.users.viewer, "GET", path());
    expect(read.status).toBe(200);
    expect(inventorySummarySchema.parse(read.json).canUpload).toBe(false);
  });

  it("hides the Project from a user outside it and from another Organization", async () => {
    for (const user of [outsider, otherOrg.users.owner, null]) {
      const read = await ctx.call(user, "GET", path());
      expect([401, 403, 404]).toContain(read.status);
    }
    expect((await ctx.call(outsider, "GET", path())).status).toBe(404);
  });

  it("does not show a System through another Project's path", async () => {
    const summary = inventorySummarySchema.parse(
      (await ctx.call(org.users.owner, "GET", path())).json,
    );
    const otherProject = await ctx.createProject(org.id, "second", []);
    const response = await ctx.call(
      org.users.owner,
      "GET",
      path(
        otherProject,
        org.id,
        `/systems/${systemId(summary, "Billing API")}/rejected-rows/export`,
      ),
    );
    expect(response.status).toBe(404);
    expect(response.json).toMatchObject({
      error: { code: "INVENTORY_SYSTEM_NOT_FOUND" },
    });
  });

  it("exports rejected rows as one sheet per Owner", async () => {
    const summary = await importCsv(
      org.users.owner,
      [
        HEADER,
        GOOD("Batch Jobs", "latest"),
        GOOD("Batch Jobs", "22.04").replace("ทีม A", "ทีม Data"),
        GOOD("Batch Jobs", "22.04.4"),
      ].join("\n"),
    );
    const exported = await fetchExport(systemId(summary, "Batch Jobs"));
    expect(exported.map((sheet) => sheet.sheet).sort()).toEqual([
      "ทีม A",
      "ทีม Data",
    ]);
    const dataSheet = exported.find((sheet) => sheet.sheet === "ทีม Data");
    expect(dataSheet?.data[0]).toEqual([
      "แถวในไฟล์",
      "System",
      "Owner",
      "Vendor",
      "Product",
      "Version",
      "Layer",
      "Environment",
      "Exposure",
      "เหตุผล",
    ]);
    expect(dataSheet?.data[1]).toEqual([
      3,
      "Batch Jobs",
      "ทีม Data",
      "Canonical",
      "Ubuntu",
      "22.04",
      "OS",
      "Production",
      "Internal",
      "Version: ไม่ถึง patch level เช่น 8.0.36 หรือ 22.04.4",
    ]);
  });
});

async function fetchExport(systemId: string) {
  const response = await ctx.app.request(
    path(projectId, org.id, `/systems/${systemId}/rejected-rows/export`),
    { headers: { "x-test-user": org.users.owner } },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
  return readExcelFile(await response.blob());
}
