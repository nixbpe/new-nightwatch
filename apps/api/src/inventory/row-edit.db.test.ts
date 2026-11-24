import {
  inventoryRowListSchema,
  inventoryRowSchema,
  inventorySummarySchema,
  type InventoryRowItem,
} from "@nightwatch/api-contract";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRedisClient } from "../rate-limit";
import {
  importResponse,
  previewFile,
  confirmPreview,
} from "./import-test-support";
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
const input = (overrides: Record<string, string> = {}) => ({
  owner: "ทีม A",
  vendor: "Canonical",
  product: "Ubuntu",
  version: "22.04.4",
  layer: "OS",
  environment: "Production",
  exposure: "Internal",
  ...overrides,
});

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let projectId: string;

const base = (project = projectId, organization = org.id) =>
  `/api/organizations/${organization}/projects/${project}/inventory`;
const rowsPath = (project = projectId, organization = org.id) =>
  `${base(project, organization)}/rows`;

const upload = (csv: string, fileName: string, project = projectId) =>
  importResponse(ctx, org.users.owner, org.id, project, csv, fileName);

async function newProject(label: string, csv?: string) {
  const project = await ctx.createProject(org.id, label, [
    { userId: org.users.viewer, role: "member" },
    { userId: projectAdmin, role: "admin" },
  ]);
  if (csv) {
    const response = await upload(csv, "inventory-q4.csv", project);
    expect(response.status).toBe(200);
  }
  return project;
}

async function listRows(
  query = "",
  project = projectId,
  user: string | null = org.users.owner,
) {
  const response = await ctx.call(
    user,
    "GET",
    `${rowsPath(project)}${query === "" ? "" : `?${query}`}`,
  );
  expect(response.status).toBe(200);
  return inventoryRowListSchema.parse(response.json);
}

async function summary(project = projectId) {
  const response = await ctx.call(org.users.owner, "GET", base(project));
  expect(response.status).toBe(200);
  return inventorySummarySchema.parse(response.json);
}

async function rowOf(
  match: (row: InventoryRowItem) => boolean,
  project = projectId,
) {
  const found = (await listRows("", project)).rows.find(match);
  if (!found) throw new Error("row missing from the list");
  return found;
}

const errorOf = (response: { json: unknown }) =>
  (
    response.json as {
      error: { code: string; message: string; details?: unknown };
    }
  ).error;

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("row-edit-a");
  otherOrg = await ctx.createOrganization("row-edit-b");
  projectAdmin = await ctx.createUser("row-edit-project-admin");
  await ctx.owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
    [crypto.randomUUID(), org.id, projectAdmin],
  );
  projectId = await newProject(
    "rows",
    [
      HEADER,
      GOOD("Billing API"),
      GOOD("Billing API", "24.04.1").replace("Ubuntu", "PostgreSQL"),
      GOOD("HR Portal"),
      GOOD("HR Portal", "22.04"),
      GOOD("HR Portal", "latest"),
    ].join("\n"),
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

describe("inventory row list", () => {
  it("returns every row with its reasons and the source of the upload that created it", async () => {
    const list = await listRows();
    expect(list).toMatchObject({ total: 5, page: 1, pageSize: 25 });
    const failing = list.rows.find((row) => row.version === "22.04");
    expect(failing).toMatchObject({
      systemName: "HR Portal",
      usable: false,
      duplicate: false,
      issues: [{ column: "Version", code: "version_not_patch_level" }],
      source: { kind: "import", fileName: "inventory-q4.csv" },
    });
    expect(failing?.source.changedBy).toBe("row-edit-a-owner");
    expect(Date.parse(failing?.source.changedAt ?? "")).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it("filters by System, Layer, status and Vendor or Product text, and keeps the filter in the total", async () => {
    const all = await listRows();
    const hr = all.rows.find((row) => row.systemName === "HR Portal");
    expect(hr).toBeDefined();
    const bySystem = await listRows(`system=${hr?.systemId ?? ""}`);
    expect(bySystem.rows.map((row) => row.systemName)).toEqual([
      "HR Portal",
      "HR Portal",
      "HR Portal",
    ]);
    expect(
      (await listRows(`system=${hr?.systemId ?? ""}&status=rejected`)).total,
    ).toBe(2);
    expect((await listRows("status=rejected")).total).toBe(2);
    expect((await listRows("layer=DB")).total).toBe(0);
    expect((await listRows("layer=OS")).total).toBe(5);
    expect((await listRows("q=postgres")).rows).toHaveLength(1);
    expect((await listRows("q=%25")).total).toBe(0);
    const unknown = await ctx.call(
      org.users.owner,
      "GET",
      `${rowsPath()}?status=nonsense`,
    );
    expect(unknown.status).toBe(400);
  });

  it("filters by Owner prefix, Environment and Exposure, combined with the other filters and counted in the total", async () => {
    const line = (
      system: string,
      owner: string,
      environment: string,
      exposure: string,
      product: string,
    ) =>
      `${system},${owner},Canonical,${product},22.04.4,OS,${environment},${exposure}`;
    const project = await newProject(
      "axes",
      [
        HEADER,
        line("Web", "Team Alpha", "Production", "Internet-facing", "Ubuntu"),
        line("Web", "team alpine", "Non-production", "Internal", "Nginx"),
        line("Batch", "Team Beta", "Production", "Isolated", "Redis"),
        line("Batch", "Alpha Ops", "Production", "Internal", "Ubuntu"),
      ].join("\n"),
    );
    const products = async (query: string) =>
      (await listRows(query, project)).rows.map((row) => row.product).sort();

    expect(await products("")).toEqual(["Nginx", "Redis", "Ubuntu", "Ubuntu"]);
    expect(await products("owner=team%20al")).toEqual(["Nginx", "Ubuntu"]);
    expect(await products("owner=team%20%20%20al")).toEqual([
      "Nginx",
      "Ubuntu",
    ]);
    expect(await products("owner=lpha")).toEqual([]);
    expect(await products("owner=%25")).toEqual([]);
    expect(await products("owner=_")).toEqual([]);
    expect(await products("owner=%20%20")).toHaveLength(4);
    expect(await products("environment=Non-production")).toEqual(["Nginx"]);
    expect(await products("exposure=Internal")).toEqual(["Nginx", "Ubuntu"]);
    expect(await products("exposure=Isolated")).toEqual(["Redis"]);
    expect(
      await products("owner=team&environment=Production&exposure=Internal"),
    ).toEqual([]);
    expect(await products("owner=alpha&environment=Production")).toEqual([
      "Ubuntu",
    ]);
    expect(await products("owner=alpha&environment=Non-production")).toEqual(
      [],
    );
    expect(
      (await listRows("environment=Production&status=rejected", project)).total,
    ).toBe(0);
    expect((await listRows("environment=Production", project)).total).toBe(3);
  });

  it("never returns a row of another Project or Organization through the new filters", async () => {
    const other = await newProject(
      "axes-other",
      [
        HEADER,
        "Elsewhere,ทีม Z,Canonical,Ubuntu,22.04.4,OS,Non-production,Isolated",
      ].join("\n"),
    );
    const query = `owner=${encodeURIComponent("ทีม")}&environment=Non-production&exposure=Isolated`;
    expect((await listRows(query)).total).toBe(0);
    expect((await listRows(query, other)).total).toBe(1);
    const foreign = await ctx.call(
      otherOrg.users.owner,
      "GET",
      `${rowsPath(other)}?${query}`,
    );
    expect(foreign.status).toBe(403);
    const outsider = await ctx.call(
      org.users.auditor,
      "GET",
      `${rowsPath(other)}?${query}`,
    );
    expect(outsider.status).toBe(404);
    const anonymous = await ctx.call(
      null,
      "GET",
      `${rowsPath(other)}?${query}`,
    );
    expect(anonymous.status).toBe(401);
  });

  it("rejects an Environment or Exposure outside the lists and an Owner over the length limit", async () => {
    for (const query of [
      "environment=Staging",
      "exposure=Public",
      "environment=production",
      `owner=${"a".repeat(201)}`,
      // A NUL byte cannot be stored and used to reach Postgres as a 500.
      "owner=%00",
      "q=%00",
    ]) {
      const response = await ctx.call(
        org.users.owner,
        "GET",
        `${rowsPath()}?${query}`,
      );
      expect(response.status, query).toBe(400);
      expect(errorOf(response).code, query).toBe("VALIDATION_ERROR");
    }
  });

  it("pages the table and answers a page past the end with the last page", async () => {
    const project = await newProject("paging");
    await ctx.owner.sql.query(
      `with s as (
         insert into inventory_systems
           (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, 'big', 'Big', 'big.csv', 'u', 30, 30) returning id)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
          layer, environment, exposure, usable, source_kind, source_file_name, changed_by)
       select $1, $2, s.id, n + 1, 'o', 'v', 'p' || n, '1.0.' || n, 'OS', 'Production', 'Internal',
              true, 'import', 'big.csv', 'u'
       from s, generate_series(1, 30) n`,
      [org.id, project],
    );
    const first = await listRows("", project);
    expect(first).toMatchObject({ total: 30, page: 1 });
    expect(first.rows).toHaveLength(25);
    const second = await listRows("page=2", project);
    expect(second.rows).toHaveLength(5);
    const beyond = await listRows("page=9", project);
    expect(beyond.page).toBe(2);
    expect(beyond.rows).toHaveLength(5);
  });
});

describe("inventory row writes", () => {
  it("adds a usable row, records who and when, recounts the System and queues the new product", async () => {
    const project = await newProject(
      "create",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const system = (await summary(project)).systems[0];
    const before = await ctx.owner.sql.query<{ total: number }>(
      "select count(*)::int as total from inventory_mappings where project_id = $1",
      [project],
    );
    const response = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(project),
      {
        systemId: system?.id,
        ...input({
          vendor: " Redis Ltd ",
          product: "Redis",
          version: "7.2.4",
          layer: "middleware",
        }),
      },
    );
    expect(response.status).toBe(201);
    const row = inventoryRowSchema.parse(response.json);
    expect(row).toMatchObject({
      vendor: "Redis Ltd",
      layer: "Middleware",
      usable: true,
      revision: 1,
      systemName: "Billing API",
      source: { kind: "manual", fileName: null, changedBy: "row-edit-a-owner" },
    });
    expect(await summary(project)).toMatchObject({
      totalRows: 2,
      usableRows: 2,
    });
    const mappings = await ctx.owner.sql.query<{
      product: string;
      status: string;
    }>(
      "select product, status from inventory_mappings where project_id = $1 order by product",
      [project],
    );
    expect(mappings.rows.map((mapping) => mapping.product)).toEqual([
      "Redis",
      "Ubuntu",
    ]);
    expect(mappings.rowCount).toBe((before.rows[0]?.total ?? 0) + 1);
    const audit = await ctx.owner.sql.query(
      "select actor_user_id, target_id from audit_events where tenant_id = $1 and action = 'organization.project.inventory.row.create' and target_id = $2",
      [org.id, project],
    );
    expect(audit.rows).toEqual([
      { actor_user_id: org.users.owner, target_id: project },
    ]);
  });

  it("keeps the entered values and names the column when a rule fails, writing nothing", async () => {
    const project = await newProject(
      "invalid",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const system = (await summary(project)).systems[0];
    const response = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(project),
      {
        systemId: system?.id,
        ...input({ version: "22.04", layer: "Kernel", owner: "" }),
      },
    );
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: "INVENTORY_ROW_INVALID",
      details: {
        issues: [
          { column: "Owner", code: "required" },
          { column: "Layer", code: "not_in_list" },
          { column: "Version", code: "version_not_patch_level" },
        ],
      },
    });
    expect((await listRows("", project)).total).toBe(1);
    expect(
      (
        await ctx.owner.sql.query(
          "select 1 from audit_events where tenant_id = $1 and action = 'organization.project.inventory.row.create' and target_id = $2",
          [org.id, project],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("applies the upload's rules, column by column, to a row typed on the screen", async () => {
    const cases: Record<string, string>[] = [
      { version: "latest" },
      { version: "22.04" },
      { product: "Ubuntu 22.04" },
      { exposure: "public" },
      { environment: "" },
      { vendor: "x".repeat(201) },
      { layer: "os" },
    ];
    const project = await newProject(
      "parity",
      [HEADER, GOOD("Seed")].join("\n"),
    );
    const system = (await summary(project)).systems[0];
    const csv = [HEADER];
    for (const [index, change] of cases.entries()) {
      const row = {
        ...input(),
        ...change,
        product: change.product ?? `P${String(index)}`,
      };
      csv.push(
        [
          `Sys${String(index)}`,
          row.owner,
          row.vendor,
          row.product,
          row.version,
          row.layer,
          row.environment,
          row.exposure,
        ].join(","),
      );
    }
    const uploaded = await upload(csv.join("\n"), "parity.csv", project);
    expect(uploaded.status).toBe(200);
    const stored = await listRows("", project);
    for (const [index, change] of cases.entries()) {
      const fromFile = stored.rows.find(
        (row) => row.systemName === `Sys${String(index)}`,
      );
      const response = await ctx.call(
        org.users.owner,
        "POST",
        rowsPath(project),
        {
          systemId: system?.id,
          ...input(),
          ...change,
          product: change.product ?? `P${String(index)}`,
        },
      );
      const screenIssues =
        response.status === 400
          ? (errorOf(response).details as { issues: unknown[] }).issues
          : [];
      expect({ change, status: response.status, issues: screenIssues }).toEqual(
        {
          change,
          status: fromFile?.usable ? 201 : 400,
          issues: fromFile?.issues ?? [],
        },
      );
    }
  });

  it("rejects a duplicate key by name, ignoring case and spaces, in the System only", async () => {
    const project = await newProject(
      "duplicate",
      [HEADER, GOOD("Billing API"), GOOD("HR Portal", "24.04.1")].join("\n"),
    );
    const [billing, hr] = (await summary(project)).systems;
    const existing = await rowOf(
      (row) => row.systemId === billing?.id,
      project,
    );
    const response = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(project),
      {
        systemId: billing?.id,
        ...input({
          vendor: "  CANONICAL ",
          product: "ubuntu",
          version: " 22.04.4 ",
          owner: "ทีม B",
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(errorOf(response)).toMatchObject({
      code: "INVENTORY_ROW_DUPLICATE",
    });
    expect(errorOf(response).message).toContain("Canonical Ubuntu 22.04.4");
    expect(errorOf(response).message).toContain("inventory-q4.csv");
    expect((await listRows(`system=${billing?.id ?? ""}`, project)).total).toBe(
      1,
    );
    // The same key in another System is a different key.
    const other = await ctx.call(org.users.owner, "POST", rowsPath(project), {
      systemId: hr?.id,
      ...input({ owner: "ทีม B" }),
    });
    expect(other.status).toBe(201);
    // Editing a row into another row's key is refused too.
    const edit = await ctx.call(org.users.owner, "POST", rowsPath(project), {
      systemId: billing?.id,
      ...input({ version: "24.04.1" }),
    });
    const created = inventoryRowSchema.parse(edit.json);
    const clash = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${created.id}`,
      { ...input({ version: "22.04.4" }), revision: created.revision },
    );
    expect(clash.status).toBe(409);
    expect(errorOf(clash).code).toBe("INVENTORY_ROW_DUPLICATE");
    expect(existing.version).toBe("22.04.4");
  });

  it("serializes two saves of the same new key so exactly one wins", async () => {
    const project = await newProject(
      "race",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const system = (await summary(project)).systems[0];
    const body = {
      systemId: system?.id,
      ...input({ product: "Redis", version: "7.2.4" }),
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        ctx.call(org.users.owner, "POST", rowsPath(project), body),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      201, 409, 409, 409,
    ]);
    expect((await listRows("q=redis", project)).total).toBe(1);
  });

  it("turns a failing row usable when its fix passes, and recomputes quality and the summary", async () => {
    const project = await newProject(
      "fix",
      [HEADER, GOOD("HR Portal"), GOOD("HR Portal", "22.04")].join("\n"),
    );
    expect((await summary(project)).systems[0]).toMatchObject({
      totalRows: 2,
      usableRows: 1,
      lowQuality: true,
    });
    const failing = await rowOf((row) => !row.usable, project);
    const response = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${failing.id}`,
      { ...input({ version: "22.04.3" }), revision: failing.revision },
    );
    expect(response.status).toBe(200);
    expect(inventoryRowSchema.parse(response.json)).toMatchObject({
      usable: true,
      issues: [],
      revision: failing.revision + 1,
      source: { kind: "manual", changedBy: "row-edit-a-owner" },
    });
    expect(await summary(project)).toMatchObject({
      totalRows: 2,
      usableRows: 2,
    });
    expect((await summary(project)).systems[0]?.lowQuality).toBe(false);
    expect((await listRows("status=rejected", project)).total).toBe(0);
    // The fixed row is usable at once, so its product is in the F-018 queue.
    const mappings = await ctx.owner.sql.query(
      "select 1 from inventory_mappings where project_id = $1",
      [project],
    );
    expect(mappings.rowCount).toBe(1);
  });

  it("moves a product through the F-018 queue when an edit renames it, and audits the edit with actor and time", async () => {
    const project = await newProject(
      "rename",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const queued = async () =>
      (
        await ctx.owner.sql.query<{ product: string; status: string }>(
          "select product, status from inventory_mappings where project_id = $1 order by product",
          [project],
        )
      ).rows;
    expect((await queued()).map((item) => item.product)).toEqual(["Ubuntu"]);
    const row = await rowOf(() => true, project);
    const before = Date.now();
    const response = await ctx.call(
      org.users.admin,
      "PUT",
      `${rowsPath(project)}/${row.id}`,
      {
        ...input({ vendor: "Acme", product: "Gadget Server" }),
        revision: row.revision,
      },
    );
    expect(response.status).toBe(200);
    // The new product waits for review at once; the product no row uses any more is gone.
    expect(await queued()).toEqual([
      { product: "Gadget Server", status: "pending" },
    ]);
    const audit = await ctx.owner.sql.query<{
      actor_user_id: string;
      target_id: string;
      occurred_at: Date;
      changes: unknown[];
    }>(
      "select actor_user_id, target_id, occurred_at, changes from audit_events where tenant_id = $1 and action = 'organization.project.inventory.row.update' and target_id = $2",
      [org.id, project],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_user_id: org.users.admin,
      changes: [],
    });
    expect(audit.rows[0]?.occurred_at.getTime()).toBeGreaterThan(
      before - 5_000,
    );
    expect(audit.rows[0]?.occurred_at.getTime()).toBeLessThan(
      Date.now() + 5_000,
    );
  });

  it("rejects a save against a revision another person has already replaced, keeping their change", async () => {
    const project = await newProject(
      "stale",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const opened = await rowOf(() => true, project);
    const theirs = await ctx.call(
      org.users.admin,
      "PUT",
      `${rowsPath(project)}/${opened.id}`,
      { ...input({ owner: "ทีม ของคนอื่น" }), revision: opened.revision },
    );
    expect(theirs.status).toBe(200);
    const mine = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${opened.id}`,
      { ...input({ owner: "ทีม ของฉัน" }), revision: opened.revision },
    );
    expect(mine.status).toBe(409);
    expect(errorOf(mine).code).toBe("INVENTORY_ROW_STALE");
    const after = await rowOf(() => true, project);
    expect(after).toMatchObject({
      owner: "ทีม ของคนอื่น",
      revision: opened.revision + 1,
      source: { changedBy: "row-edit-a-admin" },
    });
  });

  it("rejects a delete after an edit and a save after a delete, and a delete leaves the row in place", async () => {
    const project = await newProject(
      "stale-delete",
      [HEADER, GOOD("Billing API"), GOOD("Billing API", "24.04.1")].join("\n"),
    );
    const rows = (await listRows("", project)).rows;
    const [first, second] = rows;
    if (!first || !second) throw new Error("rows missing");
    await ctx.call(org.users.admin, "PUT", `${rowsPath(project)}/${first.id}`, {
      ...input({ owner: "ใหม่" }),
      revision: first.revision,
    });
    const stale = await ctx.call(
      org.users.owner,
      "DELETE",
      `${rowsPath(project)}/${first.id}?revision=${String(first.revision)}`,
    );
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe("INVENTORY_ROW_STALE");
    expect((await listRows("", project)).total).toBe(2);

    const removed = await ctx.call(
      org.users.admin,
      "DELETE",
      `${rowsPath(project)}/${second.id}?revision=${String(second.revision)}`,
    );
    expect(removed.status).toBe(204);
    const late = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${second.id}`,
      {
        ...input({ version: "24.04.1", owner: "ช้าไป" }),
        revision: second.revision,
      },
    );
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe("INVENTORY_ROW_STALE");
    expect((await listRows("", project)).total).toBe(1);
    expect(await summary(project)).toMatchObject({
      totalRows: 1,
      usableRows: 1,
    });
    expect(
      (
        await ctx.owner.sql.query(
          "select actor_user_id from audit_events where tenant_id = $1 and action = 'organization.project.inventory.row.delete' and target_id = $2",
          [org.id, project],
        )
      ).rows,
    ).toEqual([{ actor_user_id: org.users.admin }]);
  });

  it("drops a product from the F-018 queue when its last usable row is deleted", async () => {
    const project = await newProject(
      "queue",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const row = await rowOf(() => true, project);
    const queued = () =>
      ctx.owner.sql.query(
        "select 1 from inventory_mappings where project_id = $1",
        [project],
      );
    expect((await queued()).rowCount).toBe(1);
    const response = await ctx.call(
      org.users.owner,
      "DELETE",
      `${rowsPath(project)}/${row.id}?revision=${String(row.revision)}`,
    );
    expect(response.status).toBe(204);
    expect((await queued()).rowCount).toBe(0);
    expect(await summary(project)).toMatchObject({
      totalRows: 0,
      usableRows: 0,
    });
    // The System stays, empty.
    expect((await summary(project)).systemCount).toBe(1);
  });

  it("labels rows that share a key after an earlier upload and keeps them editable and deletable", async () => {
    // An import keeps one row per key, so the pair is written as an upload before F-022 left it.
    const project = await newProject("legacy-duplicates");
    await ctx.owner.sql.query(
      `with s as (
         insert into inventory_systems
           (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
         values ($1, $2, 'billing api', 'Billing API', 'old.csv', 'u', 3, 3) returning id)
       insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version, layer,
          environment, exposure, usable, source_kind, source_file_name, changed_by)
       select $1, $2, s.id, v.line, v.owner, 'Canonical', 'Ubuntu', v.version, 'OS',
              'Production', 'Internal', true, 'import', 'old.csv', 'u'
       from s, (values (2, 'ทีม A', '22.04.4'), (3, 'ทีม B', '22.04.4'), (4, 'ทีม A', '24.04.1'))
         as v(line, owner, version)`,
      [org.id, project],
    );
    const list = await listRows("", project);
    expect(list.rows.map((row) => row.duplicate)).toEqual([true, true, false]);
    expect((await listRows("status=duplicate", project)).total).toBe(2);
    const [dupA, dupB] = list.rows;
    if (!dupA || !dupB) throw new Error("rows missing");
    // A change that leaves the key as it is does not create a new clash.
    const owner = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${dupA.id}`,
      {
        ...input({ owner: "ทีม C" }),
        revision: dupA.revision,
      },
    );
    expect(owner.status).toBe(200);
    // Moving it onto the third row's key is a new clash.
    const clash = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${dupA.id}`,
      {
        ...input({ version: "24.04.1" }),
        revision: dupA.revision + 1,
      },
    );
    expect(clash.status).toBe(409);
    expect(errorOf(clash).code).toBe("INVENTORY_ROW_DUPLICATE");
    // Deleting one of the pair clears the label from the other.
    const removed = await ctx.call(
      org.users.owner,
      "DELETE",
      `${rowsPath(project)}/${dupB.id}?revision=${String(dupB.revision)}`,
    );
    expect(removed.status).toBe(204);
    expect((await listRows("status=duplicate", project)).total).toBe(0);
  });

  it("shows the upload's file name and time for earlier rows and the edit for changed ones", async () => {
    const project = await newProject(
      "provenance",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    // A row written before the provenance columns existed carries its System's upload.
    await ctx.owner.sql.query(
      `update inventory_systems set file_name = 'legacy-q3.xlsx', uploaded_by = $2,
         uploaded_at = '2026-01-02T03:04:05Z' where project_id = $1`,
      [project, org.users.admin],
    );
    await ctx.owner.sql.query(
      `update inventory_rows set source_file_name = 'legacy-q3.xlsx', changed_by = $2,
         changed_at = '2026-01-02T03:04:05Z' where project_id = $1`,
      [project, org.users.admin],
    );
    const legacy = await rowOf(() => true, project);
    expect(legacy.source).toEqual({
      kind: "import",
      fileName: "legacy-q3.xlsx",
      changedBy: "row-edit-a-admin",
      changedAt: "2026-01-02T03:04:05.000Z",
    });
    const edited = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${legacy.id}`,
      {
        ...input({ owner: "ทีม ใหม่" }),
        revision: legacy.revision,
      },
    );
    expect(inventoryRowSchema.parse(edited.json).source).toMatchObject({
      kind: "manual",
      fileName: null,
      changedBy: "row-edit-a-owner",
    });
  });
});

describe("inventory row provenance of a person who is gone", () => {
  it("lists the row with no name for the last change when the account no longer exists, and keeps the file and time", async () => {
    const project = await newProject(
      "ghost-actor",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const before = await rowOf(() => true, project);
    await ctx.owner.sql.query(
      "update inventory_rows set changed_by = 'account-deleted-id' where project_id = $1",
      [project],
    );
    const after = await rowOf(() => true, project);
    expect(after.source).toEqual({
      kind: "import",
      fileName: before.source.fileName,
      changedBy: null,
      changedAt: before.source.changedAt,
    });
  });
});

describe("inventory row permissions", () => {
  it("lets every Project member read and only a maintainer write, with 404 for a Project the caller cannot see", async () => {
    const project = await newProject(
      "matrix",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const system = (await summary(project)).systems[0];
    const row = await rowOf(() => true, project);
    const writes = (
      user: string | null,
      targetProject = project,
      organization = org.id,
    ) => [
      ctx.call(user, "POST", rowsPath(targetProject, organization), {
        systemId: system?.id,
        ...input({ product: "Nginx", version: "1.25.3" }),
      }),
      ctx.call(
        user,
        "PUT",
        `${rowsPath(targetProject, organization)}/${row.id}`,
        {
          ...input({ owner: "x" }),
          revision: row.revision,
        },
      ),
      ctx.call(
        user,
        "DELETE",
        `${rowsPath(targetProject, organization)}/${row.id}?revision=${String(row.revision)}`,
      ),
    ];
    const statuses = async (calls: ReturnType<typeof writes>) =>
      (await Promise.all(calls)).map((response) => response.status);

    // A Project member who is not a maintainer reads and cannot write.
    expect(await statuses(writes(org.users.viewer))).toEqual([403, 403, 403]);
    expect(
      (await ctx.call(org.users.viewer, "GET", rowsPath(project))).status,
    ).toBe(200);
    // An Organization member outside the Project cannot see it.
    expect(await statuses(writes(org.users.auditor))).toEqual([404, 404, 404]);
    expect(
      (await ctx.call(org.users.auditor, "GET", rowsPath(project))).status,
    ).toBe(404);
    // Nobody is signed in.
    expect(await statuses(writes(null))).toEqual([401, 401, 401]);
    expect((await ctx.call(null, "GET", rowsPath(project))).status).toBe(401);
    // Another Organization's owner reaches nothing of this one.
    const foreign = await Promise.all([
      ...writes(otherOrg.users.owner),
      ctx.call(otherOrg.users.owner, "GET", rowsPath(project)),
    ]);
    expect(foreign.map((response) => response.status)).toEqual([
      403, 403, 403, 403,
    ]);
    // Nothing above changed the data.
    expect(await listRows("", project)).toMatchObject({ total: 1 });
    expect((await rowOf(() => true, project)).owner).toBe("ทีม A");
    // Project maintainers and Organization owners and admins write.
    for (const user of [projectAdmin, org.users.owner, org.users.admin]) {
      const ok = await ctx.call(user, "PUT", `${rowsPath(project)}/${row.id}`, {
        ...input({ owner: `จาก ${user.slice(0, 4)}` }),
        revision: (await rowOf(() => true, project)).revision,
      });
      expect(ok.status).toBe(200);
    }
  });

  it("answers 404 for a Project that does not exist and 400 for a malformed body", async () => {
    const missing = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(crypto.randomUUID()),
      { systemId: crypto.randomUUID(), ...input() },
    );
    expect(missing.status).toBe(404);
    const malformed = await ctx.call(org.users.owner, "POST", rowsPath(), {
      systemId: "not-a-uuid",
    });
    expect(malformed.status).toBe(400);
  });
});

describe("inventory row edge cases", () => {
  it("does not touch a row, its revision, its source or the audit log when a save changes nothing", async () => {
    const project = await newProject(
      "noop",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const row = await rowOf(() => true, project);
    const response = await ctx.call(
      org.users.admin,
      "PUT",
      `${rowsPath(project)}/${row.id}`,
      {
        ...input({ vendor: " Canonical " }),
        revision: row.revision,
      },
    );
    expect(response.status).toBe(200);
    expect(inventoryRowSchema.parse(response.json)).toEqual(row);
    expect(
      (
        await ctx.owner.sql.query(
          "select 1 from audit_events where tenant_id = $1 and action = 'organization.project.inventory.row.update' and target_id = $2",
          [org.id, project],
        )
      ).rowCount,
    ).toBe(0);
    // A stale revision is still refused, whatever the values are.
    const stale = await ctx.call(
      org.users.admin,
      "PUT",
      `${rowsPath(project)}/${row.id}`,
      {
        ...input(),
        revision: row.revision + 1,
      },
    );
    expect(stale.status).toBe(409);
  });

  it("refuses rows for a System with no name, which only a rename can fix", async () => {
    const project = await newProject("unnamed");
    const system = await ctx.owner.sql.query<{ id: string }>(
      `insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
       values ($1, $2, '', '', 'f.csv', 'u', 0, 0) returning id`,
      [org.id, project],
    );
    const response = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(project),
      {
        systemId: system.rows[0]?.id,
        ...input(),
      },
    );
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: "INVENTORY_ROW_INVALID",
      details: { issues: [{ column: "System", code: "required" }] },
    });
    expect((await listRows("", project)).total).toBe(0);
  });

  it("treats a non-ASCII vendor that differs only in case as one key", async () => {
    const project = await newProject(
      "unicode",
      [HEADER, GOOD("Billing API").replace("Canonical", "École")].join("\n"),
    );
    const system = (await summary(project)).systems[0];
    const response = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(project),
      {
        systemId: system?.id,
        ...input({ vendor: "éCOLE" }),
      },
    );
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe("INVENTORY_ROW_DUPLICATE");
  });

  it("keeps a System's id through an import, so a dialog opened before it still saves", async () => {
    const project = await newProject(
      "merged",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const old = (await summary(project)).systems[0];
    expect(
      (
        await upload(
          [HEADER, GOOD("Billing API", "24.04.1")].join("\n"),
          "again.csv",
          project,
        )
      ).status,
    ).toBe(200);
    expect((await summary(project)).systems[0]?.id).toBe(old?.id);
    const response = await ctx.call(
      org.users.owner,
      "POST",
      rowsPath(project),
      {
        systemId: old?.id,
        ...input({ product: "Redis", version: "7.2.4" }),
      },
    );
    expect(response.status).toBe(201);
    expect((await listRows("", project)).total).toBe(3);
  });

  it("never reaches a row or System of another Project of the same Organization", async () => {
    const mine = await newProject(
      "scope-a",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const other = await newProject(
      "scope-b",
      [HEADER, GOOD("HR Portal")].join("\n"),
    );
    const foreignRow = await rowOf(() => true, other);
    const foreignSystem = (await summary(other)).systems[0];
    const put = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(mine)}/${foreignRow.id}`,
      {
        ...input({ owner: "hijack" }),
        revision: foreignRow.revision,
      },
    );
    const del = await ctx.call(
      org.users.owner,
      "DELETE",
      `${rowsPath(mine)}/${foreignRow.id}?revision=${String(foreignRow.revision)}`,
    );
    const post = await ctx.call(org.users.owner, "POST", rowsPath(mine), {
      systemId: foreignSystem?.id,
      ...input({ product: "Redis", version: "7.2.4" }),
    });
    expect([put.status, del.status, post.status]).toEqual([409, 409, 404]);
    expect(await rowOf(() => true, other)).toEqual(foreignRow);
    expect((await listRows("", other)).total).toBe(1);
    expect((await listRows("", mine)).total).toBe(1);
  });

  it("keeps System counters and rows consistent when a confirmed import and a row write race on one System", async () => {
    for (let round = 0; round < 3; round += 1) {
      const project = await newProject(
        `race-import-${String(round)}`,
        [HEADER, GOOD("Billing API")].join("\n"),
      );
      const system = (await summary(project)).systems[0];
      const previewed = await previewFile(
        ctx,
        org.users.owner,
        org.id,
        project,
        [
          HEADER,
          GOOD("Billing API", "24.04.1"),
          GOOD("Billing API", "24.04.2"),
        ].join("\n"),
        "race.csv",
      );
      expect(previewed.status).toBe(201);
      const [confirmed, created] = await Promise.all([
        confirmPreview(
          ctx,
          org.users.owner,
          org.id,
          project,
          (previewed.json as { id: string }).id,
        ),
        ctx.call(org.users.owner, "POST", rowsPath(project), {
          systemId: system?.id,
          ...input({ product: "Redis", version: "7.2.4" }),
        }),
      ]);
      // The row written first makes the preview stale; the import first leaves the System in place.
      expect(created.status).toBe(201);
      expect([200, 409]).toContain(confirmed.status);
      const systems = (await summary(project)).systems;
      const rows = await listRows("", project);
      const expected = confirmed.status === 200 ? 4 : 2;
      expect(systems).toHaveLength(1);
      expect(rows.total).toBe(expected);
      expect(systems[0]).toMatchObject({
        totalRows: expected,
        usableRows: expected,
      });
    }
  });
});

describe("inventory rows and the results of the F-020 scan", () => {
  async function seedResults(project: string) {
    const mappings = await ctx.owner.sql.query<{ id: string; product: string }>(
      "select id, product from inventory_mappings where project_id = $1",
      [project],
    );
    const run = await ctx.owner.sql.query<{ id: string }>(
      `insert into vulnerability_runs (tenant_id, project_id, status, requested_by, total_units, finished_at)
       values ($1, $2, 'done', 'u', $3, now()) returning id`,
      [org.id, project, mappings.rowCount],
    );
    for (const mapping of mappings.rows) {
      const unit = await ctx.owner.sql.query<{ id: string }>(
        `insert into vulnerability_units (tenant_id, project_id, run_id, mapping_id, version, cpe, status)
         values ($1, $2, $3, $4, $5, 'cpe:2.3:a:v:p:*:*:*:*:*:*:*:*', 'done') returning id`,
        [
          org.id,
          project,
          run.rows[0]?.id,
          mapping.id,
          mapping.product === "Redis" ? "7.2.4" : "22.04.4",
        ],
      );
      await ctx.owner.sql.query(
        `insert into vulnerability_matches (tenant_id, project_id, unit_id, cve_id, sources)
         values ($1, $2, $3, 'CVE-2024-0001', array['nvd'])`,
        [org.id, project, unit.rows[0]?.id],
      );
      for (const table of [
        "vulnerability_triage",
        "vulnerability_triage_log",
      ]) {
        await ctx.owner.sql.query(
          `insert into ${table} (tenant_id, project_id, mapping_id, version, cve_id, status, changed_by)
           values ($1, $2, $3, $4, 'CVE-2024-0001', 'affected', 'u')`,
          [
            org.id,
            project,
            mapping.id,
            mapping.product === "Redis" ? "7.2.4" : "22.04.4",
          ],
        );
      }
    }
  }

  const counts = async (project: string) =>
    (
      await ctx.owner.sql.query<{
        product: string;
        units: number;
        matches: number;
        triage: number;
        log: number;
      }>(
        `select m.product,
           (select count(*)::int from vulnerability_units u where u.mapping_id = m.id) as units,
           (select count(*)::int from vulnerability_matches v join vulnerability_units u on u.id = v.unit_id where u.mapping_id = m.id) as matches,
           (select count(*)::int from vulnerability_triage t where t.mapping_id = m.id) as triage,
           (select count(*)::int from vulnerability_triage_log t where t.mapping_id = m.id) as log
         from inventory_mappings m where m.project_id = $1 order by m.product`,
        [project],
      )
    ).rows;
  const SEEDED = { units: 1, matches: 1, triage: 1, log: 1 };

  it("keeps a product's results while another row still uses it, and drops them with its last usable row", async () => {
    const project = await newProject(
      "results-delete",
      [
        HEADER,
        GOOD("Billing API"),
        GOOD("Billing API", "24.04.1"),
        GOOD("Billing API", "7.2.4").replace("Ubuntu", "Redis"),
      ].join("\n"),
    );
    await seedResults(project);
    expect(await counts(project)).toEqual([
      { product: "Redis", ...SEEDED },
      { product: "Ubuntu", ...SEEDED },
    ]);
    const ubuntu = (await listRows("", project)).rows.filter(
      (row) => row.product === "Ubuntu",
    );
    // One Ubuntu row goes, the other keeps the product: results and VEX stay until the next scan.
    await ctx.call(
      org.users.owner,
      "DELETE",
      `${rowsPath(project)}/${ubuntu[0]?.id ?? ""}?revision=${String(ubuntu[0]?.revision)}`,
    );
    expect(await counts(project)).toEqual([
      { product: "Redis", ...SEEDED },
      { product: "Ubuntu", ...SEEDED },
    ]);
    // The last usable Ubuntu row goes: the mapping, and with it units, matches and VEX, at once.
    await ctx.call(
      org.users.owner,
      "DELETE",
      `${rowsPath(project)}/${ubuntu[1]?.id ?? ""}?revision=${String(ubuntu[1]?.revision)}`,
    );
    expect(await counts(project)).toEqual([{ product: "Redis", ...SEEDED }]);
  });

  it("keeps the results of a product when an edit changes only its Version, and drops them when it changes the product", async () => {
    const project = await newProject(
      "results-edit",
      [HEADER, GOOD("Billing API", "7.2.4").replace("Ubuntu", "Redis")].join(
        "\n",
      ),
    );
    await seedResults(project);
    const row = await rowOf(() => true, project);
    const version = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${row.id}`,
      {
        ...input({ product: "Redis", version: "7.2.5" }),
        revision: row.revision,
      },
    );
    expect(version.status).toBe(200);
    expect(await counts(project)).toEqual([{ product: "Redis", ...SEEDED }]);
    const renamed = await ctx.call(
      org.users.owner,
      "PUT",
      `${rowsPath(project)}/${row.id}`,
      {
        ...input({ product: "Valkey", version: "7.2.5" }),
        revision: row.revision + 1,
      },
    );
    expect(renamed.status).toBe(200);
    expect(await counts(project)).toEqual([
      { product: "Valkey", units: 0, matches: 0, triage: 0, log: 0 },
    ]);
  });
});
