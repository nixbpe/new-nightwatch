import {
  inventoryRejectedRowsSchema,
  inventorySummarySchema,
} from "@nightwatch/api-contract";
import type { Redis } from "ioredis";
import readExcelFile from "read-excel-file/universal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRedisClient } from "../rate-limit";
import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for inventory tests");

const HEADER = "System,Owner,Vendor,Product,Version,Layer,Environment,Exposure";
const GOOD = (system: string, version = "22.04.4") =>
  `${system},ทีม A,Canonical,Ubuntu,${version},OS,Production,Internal`;

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let outsider: string;
let projectId: string;

const path = (project = projectId, organization = org.id, suffix = "") =>
  `/api/organizations/${organization}/projects/${project}/inventory${suffix}`;

function upload(
  userId: string | null,
  csv: string,
  fileName = "inventory.csv",
  project = projectId,
  organization = org.id,
) {
  const boundary = "----nightwatch-boundary";
  const text =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
  return ctx.call(userId, "POST", path(project, organization), undefined, {
    text,
    contentType: `multipart/form-data; boundary=${boundary}`,
  });
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
  const keys = await redis.keys("rl:inventory-upload:*");
  if (keys.length > 0) await redis.del(...keys);
  await ctx.close();
  redis.disconnect();
});

describe("inventory upload", () => {
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
    const response = await upload(org.users.owner, csv, "inventory-q4.csv");
    expect(response.status).toBe(200);
    const summary = inventorySummarySchema.parse(response.json);
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
        `/systems/${systemId(summary, "HR Portal")}/rejected-rows`,
      ),
    );
    expect(rejected.status).toBe(200);
    expect(inventoryRejectedRowsSchema.parse(rejected.json).rows).toMatchObject(
      [
        {
          line: 5,
          issues: [{ column: "Version", code: "version_not_patch_level" }],
        },
        {
          line: 6,
          issues: [{ column: "Version", code: "version_not_a_number" }],
        },
        {
          line: 7,
          issues: [
            { column: "Layer", code: "not_in_list" },
            { column: "Version", code: "version_not_patch_level" },
          ],
        },
      ],
    );
  });

  it("replaces only the Systems named in the file and records one audit event", async () => {
    const before = await storedRows();
    expect(before).toHaveLength(6);
    const response = await upload(
      org.users.admin,
      [
        HEADER,
        GOOD("billing api", "24.04.1"),
        GOOD("billing api", "22.04.4"),
      ].join("\n"),
    );
    expect(response.status).toBe(200);
    expect(await storedRows()).toEqual([
      { name: "billing api", line_no: 2, usable: true },
      { name: "billing api", line_no: 3, usable: true },
      ...before.filter((row) => row.name === "HR Portal"),
    ]);
    const audit = await ctx.owner.sql.query(
      "select actor_user_id, target_id from audit_events where tenant_id = $1 and action = 'organization.project.inventory.upload' order by occurred_at",
      [org.id],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1]).toMatchObject({
      actor_user_id: org.users.admin,
      target_id: projectId,
    });
  });

  it("rejects the whole file and keeps the earlier data when a column is missing", async () => {
    const before = await storedRows();
    const response = await upload(
      org.users.owner,
      "System,Owner,Vendor,Product,Version,Layer,Environment,Hostname\nA,B,C,D,1.2.3,OS,Production,h\n",
      "../../draft.csv",
    );
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({
      error: {
        code: "INVENTORY_FILE_REJECTED",
        message:
          "ไฟล์ draft.csv ถูกปฏิเสธ ไม่มีข้อมูลใดถูกนำเข้า: ขาดคอลัมน์ Exposure และมีคอลัมน์ที่ไม่อยู่ใน template: Hostname",
      },
    });
    expect(await storedRows()).toEqual(before);
  });

  it("answers 413 in the error envelope for an oversized body", async () => {
    const response = await upload(
      org.users.owner,
      `${HEADER}\n${"x".repeat(2 * 1024 * 1024 + 70_000)}`,
    );
    expect(response.status).toBe(413);
    expect(response.json).toMatchObject({
      error: { code: "INVENTORY_FILE_REJECTED" },
    });
  });

  it("lets a Project admin upload and refuses a Project member", async () => {
    const asAdmin = await upload(
      projectAdmin,
      [HEADER, GOOD("Partner Portal")].join("\n"),
    );
    expect(asAdmin.status).toBe(200);
    expect(inventorySummarySchema.parse(asAdmin.json).canUpload).toBe(true);
    const before = await storedRows();
    const asMember = await upload(
      org.users.viewer,
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
      const write = await upload(user, [HEADER, GOOD("Nope")].join("\n"));
      expect([401, 403, 404]).toContain(write.status);
    }
    expect((await ctx.call(outsider, "GET", path())).status).toBe(404);
    expect((await storedRows()).some((row) => row.name === "Nope")).toBe(false);
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
        `/systems/${systemId(summary, "billing api")}/rejected-rows`,
      ),
    );
    expect(response.status).toBe(404);
    expect(response.json).toMatchObject({
      error: { code: "INVENTORY_SYSTEM_NOT_FOUND" },
    });
  });

  it("exports rejected rows as one sheet per Owner", async () => {
    const response = await upload(
      org.users.owner,
      [
        HEADER,
        GOOD("Batch Jobs", "latest"),
        GOOD("Batch Jobs", "22.04").replace("ทีม A", "ทีม Data"),
        GOOD("Batch Jobs", "22.04.4"),
      ].join("\n"),
    );
    const summary = inventorySummarySchema.parse(response.json);
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

  it("limits uploads per user and Project", async () => {
    const keys = await redis.keys(`rl:inventory-upload:u:${org.users.owner}:*`);
    if (keys.length > 0) await redis.del(...keys);
    const csv = [HEADER, GOOD("Limiter")].join("\n");
    let last = 200;
    for (let i = 0; i < 11; i += 1) {
      last = (await upload(org.users.owner, csv)).status;
    }
    expect(last).toBe(429);
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
