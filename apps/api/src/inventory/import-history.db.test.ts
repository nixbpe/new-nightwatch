import {
  INVENTORY_IMPORTS_PAGE_SIZE,
  inventoryImportListSchema,
} from "@nightwatch/api-contract";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";
import { createRedisClient } from "../rate-limit";
import {
  GOOD,
  HEADER,
  cancelPreview,
  importFile,
  previewFile,
} from "./import-test-support";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for inventory tests");

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let outsider: string;

const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");
const historyPath = (project: string, organization = org.id, query = "") =>
  `/api/organizations/${organization}/projects/${project}/inventory/imports${query}`;

const project = (label: string) =>
  ctx.createProject(org.id, label, [
    { userId: org.users.viewer, role: "member" },
    { userId: projectAdmin, role: "admin" },
  ]);

async function history(
  user: string | null,
  target: string,
  organization = org.id,
  query = "",
) {
  const response = await ctx.call(
    user,
    "GET",
    historyPath(target, organization, query),
  );
  return {
    status: response.status,
    list:
      response.status === 200
        ? inventoryImportListSchema.parse(response.json)
        : null,
    json: response.json as { error?: { code: string } } | null,
  };
}

// The counts a row of the history carries are the confirm result's; bulk rows come from SQL
// because each confirm spends the person's preview quota.
async function record(
  target: string,
  at: string,
  by: string,
  fileName = "seeded.csv",
  organization = org.id,
) {
  const inserted = await ctx.owner.sql.query<{ id: string }>(
    `insert into inventory_imports
       (tenant_id, project_id, imported_by, file_name, imported_at, added, updated, unchanged, skipped, failed)
     values ($1, $2, $3, $4, $5, 1, 2, 3, 4, 5) returning id`,
    [organization, target, by, fileName, at],
  );
  return inserted.rows[0]?.id ?? "";
}

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("history-a");
  otherOrg = await ctx.createOrganization("history-b");
  projectAdmin = await ctx.createUser("history-project-admin");
  outsider = await ctx.createUser("history-outsider");
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

describe("import history (S7.5)", () => {
  it("lists the confirmed imports newest first with the confirm result's file name, time, importer and counts", async () => {
    const target = await project("history-list");
    const first = await importFile(
      ctx,
      org.users.owner,
      org.id,
      target,
      csv(GOOD("Billing API"), GOOD("Billing API", "22.04")),
      "q3.csv",
    );
    const second = await importFile(
      ctx,
      projectAdmin,
      org.id,
      target,
      csv(
        GOOD("Billing API"),
        GOOD("Billing API", "24.04.1"),
        GOOD("HR Portal", "latest"),
      ),
      "ไฟล์ q4.csv",
    );
    // Pending, cancelled and expired previews are not imports.
    const cancelled = await previewFile(
      ctx,
      org.users.owner,
      org.id,
      target,
      csv(GOOD("Cancelled")),
      "cancelled.csv",
    );
    expect(cancelled.status).toBe(201);
    await cancelPreview(
      ctx,
      org.users.owner,
      org.id,
      target,
      (cancelled.json as { id: string }).id,
    );
    await previewFile(
      ctx,
      projectAdmin,
      org.id,
      target,
      csv(GOOD("Expired")),
      "expired.csv",
    );
    await ctx.owner.sql.query(
      `update inventory_previews set created_at = created_at - interval '31 minutes',
         expires_at = expires_at - interval '31 minutes' where project_id = $1`,
      [target],
    );
    await previewFile(
      ctx,
      org.users.owner,
      org.id,
      target,
      csv(GOOD("Pending")),
      "pending.csv",
    );

    const { status, list } = await history(org.users.owner, target);
    expect(status).toBe(200);
    expect(list).toMatchObject({
      total: 2,
      page: 1,
      pageSize: INVENTORY_IMPORTS_PAGE_SIZE,
    });
    expect(list?.imports.map((item) => item.fileName)).toEqual([
      "ไฟล์ q4.csv",
      "q3.csv",
    ]);
    expect(list?.imports[0]).toEqual({
      id: expect.any(String) as string,
      fileName: second.result.fileName,
      importedAt: second.result.importedAt,
      importedBy: "history-project-admin",
      ...second.result.totals,
    });
    expect(list?.imports[1]).toMatchObject({
      importedAt: first.result.importedAt,
      importedBy: "history-a-owner",
      ...first.result.totals,
    });
    // Metadata only: the row carries these keys and no file content or rows.
    expect(Object.keys(list?.imports[0] ?? {}).sort()).toEqual([
      "added",
      "failed",
      "fileName",
      "id",
      "importedAt",
      "importedBy",
      "skipped",
      "unchanged",
      "updated",
    ]);
  });

  it("is empty for a Project that was never imported into", async () => {
    const target = await project("history-empty");
    expect((await history(org.users.owner, target)).list).toEqual({
      imports: [],
      total: 0,
      page: 1,
      pageSize: INVENTORY_IMPORTS_PAGE_SIZE,
    });
  });

  it("orders equal times by id and pages without a gap or a repeat", async () => {
    const target = await project("history-pages");
    const stamps = ["2026-11-20T10:00:00Z", "2026-11-21T10:00:00Z"];
    const ids: string[] = [];
    // 45 records in two time groups, so a tie crosses a page boundary.
    for (let i = 0; i < 45; i += 1) {
      ids.push(await record(target, stamps[i < 25 ? 1 : 0] ?? "", "someone"));
    }
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const { list } = await history(
        org.users.owner,
        target,
        org.id,
        `?page=${String(page)}`,
      );
      expect(list).toMatchObject({ total: 45, page });
      expect(list?.imports).toHaveLength(page === 3 ? 5 : 20);
      seen.push(...(list?.imports.map((item) => item.id) ?? []));
    }
    expect(new Set(seen).size).toBe(45);
    const newest = ids.slice(0, 25).sort().reverse();
    const oldest = ids.slice(25).sort().reverse();
    expect(seen).toEqual([...newest, ...oldest]);

    const past = await history(org.users.owner, target, org.id, "?page=99");
    expect(past.list?.page).toBe(3);
    expect(past.list?.imports.map((item) => item.id)).toEqual(seen.slice(40));
    expect(
      (await history(org.users.owner, target, org.id, "?page=0")).status,
    ).toBe(400);
  });

  it("shows no importer name when the account is gone", async () => {
    const target = await project("history-ghost");
    await record(target, "2026-11-21T10:00:00Z", "deleted-user-id");
    const { list } = await history(org.users.owner, target);
    expect(list?.imports[0]?.importedBy).toBeNull();
  });

  it("lets every Project member read, and answers 404, 401 and the foreign Organization by the rules of the other reads", async () => {
    const target = await project("history-matrix");
    await record(target, "2026-11-21T10:00:00Z", org.users.owner);
    for (const user of [
      org.users.viewer, // Project member
      projectAdmin, // Project admin
      org.users.admin, // Organization admin, not a Project member
      org.users.owner,
    ]) {
      const { status, list } = await history(user, target);
      expect(status).toBe(200);
      expect(list?.total).toBe(1);
    }
    const hidden = await history(outsider, target);
    expect(hidden.status).toBe(404);
    expect(hidden.json?.error?.code).toBe("PROJECT_NOT_FOUND");
    expect((await history(null, target)).status).toBe(401);
    // Not a member of the Organization: refused before any Project is looked up.
    const foreign = await history(otherOrg.users.owner, target);
    expect(foreign.status).toBe(403);
    expect(foreign.json?.error?.code).toBe("MEMBERSHIP_DENIED");
  });

  it("never lists another Project's or another Organization's imports", async () => {
    const mine = await project("history-scope-a");
    const sibling = await project("history-scope-b");
    const foreignProject = await ctx.createProject(otherOrg.id, "foreign", []);
    await record(mine, "2026-11-21T10:00:00Z", org.users.owner, "mine.csv");
    await record(
      sibling,
      "2026-11-22T10:00:00Z",
      org.users.owner,
      "sibling.csv",
    );
    await record(
      foreignProject,
      "2026-11-23T10:00:00Z",
      otherOrg.users.owner,
      "foreign.csv",
      otherOrg.id,
    );
    const list = (await history(org.users.owner, mine)).list;
    expect(list?.imports.map((item) => item.fileName)).toEqual(["mine.csv"]);
    expect(list?.total).toBe(1);
    // A Project of another Organization under this Organization's id is not found.
    const crossed = await history(org.users.owner, foreignProject, org.id);
    expect(crossed.status).toBe(404);
  });

  it("goes with the Project", async () => {
    const target = await project("history-gone");
    await importFile(
      ctx,
      org.users.owner,
      org.id,
      target,
      csv(GOOD("Billing API")),
    );
    await record(target, "2026-11-21T10:00:00Z", org.users.owner);
    const count = () =>
      ctx.owner.sql.query<{ n: number }>(
        "select count(*)::int as n from inventory_imports where project_id = $1",
        [target],
      );
    expect((await count()).rows[0]?.n).toBe(2);
    expect(
      (
        await ctx.call(
          org.users.owner,
          "DELETE",
          `/api/organizations/${org.id}/projects/${target}`,
        )
      ).status,
    ).toBe(204);
    expect((await count()).rows[0]?.n).toBe(0);
    expect((await history(org.users.owner, target)).status).toBe(404);
  });
});
