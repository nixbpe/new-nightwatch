import {
  inventoryMappingListSchema,
  inventoryRowListSchema,
  inventorySummarySchema,
  inventorySystemSchema,
  type InventorySummary,
} from "@nightwatch/api-contract";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRedisClient } from "../rate-limit";
import { importResponse } from "./import-test-support";
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
const fields = (overrides: Record<string, string> = {}) => ({
  owner: "ทีม A",
  vendor: "Redis Ltd",
  product: "Redis",
  version: "7.2.4",
  layer: "Middleware",
  environment: "Production",
  exposure: "Internal",
  ...overrides,
});
const newSystem = (name: string, overrides: Record<string, string> = {}) => ({
  name,
  ...fields(overrides),
});

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectAdmin: string;
let seq = 0;

const base = (project: string, organization = org.id) =>
  `/api/organizations/${organization}/projects/${project}/inventory`;
const systemsPath = (project: string, organization = org.id) =>
  `${base(project, organization)}/systems`;
const systemPath = (project: string, id: string) =>
  `${systemsPath(project)}/${id}`;
const deletePath = (
  project: string,
  system: { id: string; revision: number; totalRows: number },
  organization = org.id,
) =>
  `${systemsPath(project, organization)}/${system.id}?revision=${String(system.revision)}&rows=${String(system.totalRows)}`;

const errorOf = (response: { json: unknown }) =>
  (
    response.json as {
      error: { code: string; message: string; details?: unknown };
    }
  ).error;

const projects: string[] = [];
const upload = (csv: string, fileName: string, project: string) =>
  importResponse(ctx, org.users.owner, org.id, project, csv, fileName);

async function newProject(label: string, csv?: string) {
  seq += 1;
  const project = await ctx.createProject(org.id, `${label}-${String(seq)}`, [
    { userId: org.users.viewer, role: "member" },
    { userId: projectAdmin, role: "admin" },
  ]);
  projects.push(project);
  if (csv)
    expect((await upload(csv, "inventory-q4.csv", project)).status).toBe(200);
  return project;
}

async function summary(project: string): Promise<InventorySummary> {
  const response = await ctx.call(org.users.owner, "GET", base(project));
  expect(response.status).toBe(200);
  return inventorySummarySchema.parse(response.json);
}

async function rows(project: string, query = "") {
  const response = await ctx.call(
    org.users.owner,
    "GET",
    `${base(project)}/rows${query === "" ? "" : `?${query}`}`,
  );
  expect(response.status).toBe(200);
  return inventoryRowListSchema.parse(response.json).rows;
}

async function systemNamed(project: string, name: string) {
  const found = (await summary(project)).systems.find(
    (system) => system.name === name,
  );
  if (!found) throw new Error(`System ${name} is missing`);
  return found;
}

const events = async (project: string, action: string) =>
  (
    await ctx.owner.sql.query<{ actor_user_id: string; attrs: unknown }>(
      `select actor_user_id, target_attributes as attrs from audit_events
       where tenant_id = $1 and target_id = $2 and action = $3`,
      [org.id, project, action],
    )
  ).rows;

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("system-edit-a");
  otherOrg = await ctx.createOrganization("system-edit-b");
  projectAdmin = await ctx.createUser("system-edit-project-admin");
  await ctx.owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
    [crypto.randomUUID(), org.id, projectAdmin],
  );
}, 120_000);

afterAll(async () => {
  const keys = [
    ...(
      await Promise.all(
        projects.map((project) =>
          redis.keys(`rl:inventory-import:u:*:p:${project}`),
        ),
      )
    ).flat(),
    `rl:inventory-import:o:${org.id}`,
  ];
  await redis.del(...keys);
  await ctx.close();
  redis.disconnect();
});

describe("creating a System", () => {
  it("creates the System with its first row in one step, from no file, and queues the product", async () => {
    const project = await newProject(
      "create",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const before = await summary(project);
    const response = await ctx.call(
      org.users.admin,
      "POST",
      systemsPath(project),
      newSystem("  HR   Portal "),
    );
    expect(response.status).toBe(201);
    const created = inventorySystemSchema.parse(response.json);
    expect(created).toMatchObject({
      name: "HR Portal",
      totalRows: 1,
      usableRows: 1,
      fileName: null,
      revision: 1,
      owners: ["ทีม A"],
    });
    const list = await rows(project, `system=${created.id}`);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      product: "Redis",
      usable: true,
      source: { kind: "manual", changedBy: "system-edit-a-admin" },
    });
    const after = await summary(project);
    expect(after).toMatchObject({
      systemCount: 2,
      totalRows: 2,
      usableRows: 2,
    });
    // A System typed on the screen is not an upload.
    expect(after.lastUploadFileName).toBe(before.lastUploadFileName);
    expect(after.lastUploadAt).toBe(before.lastUploadAt);
    expect(
      (
        await ctx.owner.sql.query(
          "select 1 from inventory_mappings where project_id = $1 and product = 'Redis' and status in ('pending', 'confirmed')",
          [project],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      await events(project, "organization.project.inventory.system.create"),
    ).toMatchObject([
      { actor_user_id: org.users.admin, attrs: { systemId: created.id } },
    ]);
  });

  it("refuses a name another System has, ignoring case and outer spaces, and writes nothing", async () => {
    const project = await newProject(
      "dup-create",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    for (const name of ["billing api", "  BILLING API  ", "Billing   API"]) {
      const response = await ctx.call(
        org.users.owner,
        "POST",
        systemsPath(project),
        newSystem(name),
      );
      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe("INVENTORY_SYSTEM_NAME_TAKEN");
    }
    expect((await summary(project)).systemCount).toBe(1);
    expect((await rows(project)).length).toBe(1);
    // The same name is free in another Project of the Organization.
    const other = await newProject("dup-other");
    expect(
      (
        await ctx.call(
          org.users.owner,
          "POST",
          systemsPath(other),
          newSystem("Billing API"),
        )
      ).status,
    ).toBe(201);
  });

  it("applies the upload's rules to the name and the first row, leaving no System behind", async () => {
    const project = await newProject("invalid-create");
    const cases: [
      Record<string, string>,
      { column: string; code: string }[],
    ][] = [
      [{ name: " " }, [{ column: "System", code: "required" }]],
      [{ name: "x".repeat(201) }, [{ column: "System", code: "too_long" }]],
      [
        { version: "7.2", layer: "Kernel", name: "Cache" },
        [
          { column: "Layer", code: "not_in_list" },
          { column: "Version", code: "version_not_patch_level" },
        ],
      ],
      [
        { name: "", product: "Redis 7.2" },
        [
          { column: "System", code: "required" },
          { column: "Product", code: "product_has_version" },
        ],
      ],
    ];
    for (const [override, issues] of cases) {
      const response = await ctx.call(
        org.users.owner,
        "POST",
        systemsPath(project),
        {
          ...newSystem("Cache"),
          ...override,
        },
      );
      expect(response.status).toBe(400);
      expect(errorOf(response)).toMatchObject({
        code: "INVENTORY_ROW_INVALID",
        details: { issues },
      });
    }
    expect((await summary(project)).systemCount).toBe(0);
  });
});

describe("renaming a System", () => {
  it("keeps every row id, the results and the VEX of the System and shows the new name in the table, the list and the queue", async () => {
    const project = await newProject(
      "rename",
      [HEADER, GOOD("Billing API"), GOOD("Billing API", "24.04.1")].join("\n"),
    );
    await seedResults(project);
    const system = await systemNamed(project, "Billing API");
    const idsBefore = (await rows(project)).map((row) => row.id).sort();
    const resultsBefore = await resultCounts(project);

    const response = await ctx.call(
      org.users.admin,
      "PATCH",
      systemPath(project, system.id),
      { name: "Payments API", revision: system.revision },
    );
    expect(response.status).toBe(200);
    expect(inventorySystemSchema.parse(response.json)).toMatchObject({
      id: system.id,
      name: "Payments API",
      revision: system.revision + 1,
      totalRows: 2,
      usableRows: 2,
    });
    expect((await rows(project)).map((row) => row.id).sort()).toEqual(
      idsBefore,
    );
    expect(
      (await rows(project)).every((row) => row.systemName === "Payments API"),
    ).toBe(true);
    expect((await summary(project)).systems.map((item) => item.name)).toEqual([
      "Payments API",
    ]);
    expect(await resultCounts(project)).toEqual(resultsBefore);
    expect(resultsBefore[0]).toMatchObject({
      units: 1,
      matches: 1,
      triage: 1,
      log: 1,
    });
    const queue = await ctx.call(
      org.users.owner,
      "GET",
      `${base(project)}/mappings`,
    );
    expect(
      inventoryMappingListSchema
        .parse(queue.json)
        .items.flatMap((item) => item.systems),
    ).toEqual(["Payments API"]);
    expect(
      await events(project, "organization.project.inventory.system.rename"),
    ).toMatchObject([
      { actor_user_id: org.users.admin, attrs: { systemId: system.id } },
    ]);
  });

  it("refuses a name another System has, allows a change of case or spacing of its own name and treats the same name as no change", async () => {
    const project = await newProject(
      "rename-dup",
      [HEADER, GOOD("Billing API"), GOOD("HR Portal")].join("\n"),
    );
    const billing = await systemNamed(project, "Billing API");
    const clash = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, billing.id),
      {
        name: "  hr PORTAL ",
        revision: billing.revision,
      },
    );
    expect(clash.status).toBe(409);
    expect(errorOf(clash).code).toBe("INVENTORY_SYSTEM_NAME_TAKEN");
    expect((await systemNamed(project, "Billing API")).revision).toBe(
      billing.revision,
    );

    const same = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, billing.id),
      {
        name: " Billing API ",
        revision: billing.revision,
      },
    );
    expect(same.status).toBe(200);
    expect(inventorySystemSchema.parse(same.json).revision).toBe(
      billing.revision,
    );
    expect(
      await events(project, "organization.project.inventory.system.rename"),
    ).toHaveLength(0);

    const cased = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, billing.id),
      {
        name: "BILLING api",
        revision: billing.revision,
      },
    );
    expect(cased.status).toBe(200);
    expect(inventorySystemSchema.parse(cased.json)).toMatchObject({
      name: "BILLING api",
      revision: billing.revision + 1,
    });

    const empty = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, billing.id),
      {
        name: "   ",
        revision: billing.revision + 1,
      },
    );
    expect(empty.status).toBe(400);
    expect(errorOf(empty)).toMatchObject({
      code: "INVENTORY_ROW_INVALID",
      details: { issues: [{ column: "System", code: "required" }] },
    });
  });

  it("makes the rows of a System with no name editable once it is renamed", async () => {
    const project = await newProject("unnamed");
    const inserted = await ctx.owner.sql.query<{ id: string }>(
      `insert into inventory_systems
         (tenant_id, project_id, name_key, name, file_name, uploaded_by, total_rows, usable_rows)
       values ($1, $2, '', '', 'f.csv', 'u', 1, 0) returning id`,
      [org.id, project],
    );
    const systemId = inserted.rows[0]?.id ?? "";
    await ctx.owner.sql.query(
      `insert into inventory_rows
         (tenant_id, project_id, system_id, line_no, owner, vendor, product, version,
          layer, environment, exposure, usable, issues, source_kind, source_file_name, changed_by)
       values ($1, $2, $3, 2, 'ทีม A', 'Canonical', 'Ubuntu', '22.04.4', 'OS', 'Production',
          'Internal', false, '[{"column":"System","code":"required"}]'::jsonb, 'import', 'f.csv', 'u')`,
      [org.id, project, systemId],
    );
    const [row] = await rows(project);
    const edit = (revision: number) =>
      ctx.call(
        org.users.owner,
        "PUT",
        `${base(project)}/rows/${row?.id ?? ""}`,
        {
          ...fields({
            vendor: "Canonical",
            product: "Ubuntu",
            version: "22.04.4",
            layer: "OS",
          }),
          revision,
        },
      );
    expect((await edit(row?.revision ?? 1)).status).toBe(400);

    const system = (await summary(project)).systems[0];
    const renamed = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, systemId),
      {
        name: "Legacy",
        revision: system?.revision ?? 1,
      },
    );
    expect(renamed.status).toBe(200);
    const saved = await edit(row?.revision ?? 1);
    expect(saved.status).toBe(200);
    expect((await rows(project))[0]).toMatchObject({
      usable: true,
      systemName: "Legacy",
    });
    expect(await summary(project)).toMatchObject({
      totalRows: 1,
      usableRows: 1,
    });
  });
});

describe("deleting a System", () => {
  it("removes the System and its rows and leaves the same results and VEX as deleting its rows one by one", async () => {
    const csv = [
      HEADER,
      GOOD("Billing API"),
      GOOD("Billing API", "24.04.1"),
      GOOD("Billing API", "7.2.4").replace("Ubuntu", "Redis"),
      GOOD("HR Portal", "22.04.4"),
    ].join("\n");
    const whole = await newProject("delete-whole", csv);
    const oneByOne = await newProject("delete-rows", csv);
    await seedResults(whole);
    await seedResults(oneByOne);
    expect(await resultCounts(whole)).toEqual(await resultCounts(oneByOne));

    const target = await systemNamed(whole, "Billing API");
    expect(target.totalRows).toBe(3);
    const response = await ctx.call(
      org.users.admin,
      "DELETE",
      deletePath(whole, target),
    );
    expect(response.status).toBe(204);

    for (const row of (await rows(oneByOne)).filter(
      (item) => item.systemName === "Billing API",
    )) {
      expect(
        (
          await ctx.call(
            org.users.owner,
            "DELETE",
            `${base(oneByOne)}/rows/${row.id}?revision=${String(row.revision)}`,
          )
        ).status,
      ).toBe(204);
    }
    const left = await resultCounts(whole);
    expect(left).toEqual(await resultCounts(oneByOne));
    // Redis was only in the deleted System: its mapping, units, matches and VEX are gone with it.
    expect(left.map((item) => item.product)).toEqual(["Ubuntu"]);
    expect(await rows(whole)).toHaveLength(1);
    expect((await summary(whole)).systems.map((item) => item.name)).toEqual([
      "HR Portal",
    ]);
    expect(
      await events(whole, "organization.project.inventory.system.delete"),
    ).toMatchObject([
      {
        actor_user_id: org.users.admin,
        attrs: { systemId: target.id, rows: 3 },
      },
    ]);
  });

  it("refuses a delete when the System was renamed, grew a row by an add or an import, or is already gone", async () => {
    const project = await newProject(
      "stale-delete",
      [HEADER, GOOD("Billing API"), GOOD("HR Portal"), GOOD("Payroll")].join(
        "\n",
      ),
    );
    const billing = await systemNamed(project, "Billing API");
    const hr = await systemNamed(project, "HR Portal");
    const payroll = await systemNamed(project, "Payroll");

    // Renamed by someone else.
    await ctx.call(org.users.admin, "PATCH", systemPath(project, billing.id), {
      name: "Billing",
      revision: billing.revision,
    });
    // A row added by someone else after the dialog counted 1.
    await ctx.call(org.users.admin, "POST", `${base(project)}/rows`, {
      systemId: hr.id,
      ...fields(),
    });
    // A row added by an import after the dialog counted 1.
    await upload(
      [HEADER, GOOD("Payroll", "24.04.1")].join("\n"),
      "again.csv",
      project,
    );

    for (const stale of [billing, hr, payroll]) {
      const response = await ctx.call(
        org.users.owner,
        "DELETE",
        deletePath(project, stale),
      );
      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe("INVENTORY_SYSTEM_STALE");
    }
    expect((await rows(project)).length).toBe(5);

    const current = await systemNamed(project, "HR Portal");
    expect(current.totalRows).toBe(2);
    expect(
      (await ctx.call(org.users.owner, "DELETE", deletePath(project, current)))
        .status,
    ).toBe(204);
    const gone = await ctx.call(
      org.users.owner,
      "DELETE",
      deletePath(project, current),
    );
    expect(gone.status).toBe(409);
    expect(errorOf(gone).code).toBe("INVENTORY_SYSTEM_STALE");
  });

  it("refuses a rename of a System renamed, replaced or deleted by someone else, keeping their change", async () => {
    const project = await newProject(
      "stale-rename",
      [HEADER, GOOD("Billing API"), GOOD("HR Portal")].join("\n"),
    );
    const billing = await systemNamed(project, "Billing API");
    const hr = await systemNamed(project, "HR Portal");
    await ctx.call(org.users.admin, "PATCH", systemPath(project, billing.id), {
      name: "Billing 2",
      revision: billing.revision,
    });
    const late = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, billing.id),
      {
        name: "Mine",
        revision: billing.revision,
      },
    );
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe("INVENTORY_SYSTEM_STALE");
    expect((await summary(project)).systems.map((item) => item.name)).toContain(
      "Billing 2",
    );

    await ctx.call(org.users.admin, "DELETE", deletePath(project, hr));
    const afterDelete = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, hr.id),
      {
        name: "Mine",
        revision: hr.revision,
      },
    );
    expect(afterDelete.status).toBe(409);
    expect(errorOf(afterDelete).code).toBe("INVENTORY_SYSTEM_STALE");
    expect((await summary(project)).systems.map((item) => item.name)).toEqual([
      "Billing 2",
    ]);
  });

  it("keeps a System whose rows were all deleted as an empty System that can take a row, be renamed and be deleted", async () => {
    const project = await newProject(
      "empty",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const [row] = await rows(project);
    expect(
      (
        await ctx.call(
          org.users.owner,
          "DELETE",
          `${base(project)}/rows/${row?.id ?? ""}?revision=${String(row?.revision)}`,
        )
      ).status,
    ).toBe(204);
    const empty = await systemNamed(project, "Billing API");
    expect(empty).toMatchObject({ totalRows: 0, usableRows: 0, owners: [] });
    expect(await summary(project)).toMatchObject({
      systemCount: 1,
      totalRows: 0,
    });

    const added = await ctx.call(
      org.users.owner,
      "POST",
      `${base(project)}/rows`,
      {
        systemId: empty.id,
        ...fields(),
      },
    );
    expect(added.status).toBe(201);
    const [again] = await rows(project);
    await ctx.call(
      org.users.owner,
      "DELETE",
      `${base(project)}/rows/${again?.id ?? ""}?revision=${String(again?.revision)}`,
    );
    const renamed = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(project, empty.id),
      {
        name: "Still here",
        revision: empty.revision,
      },
    );
    expect(renamed.status).toBe(200);
    const current = await systemNamed(project, "Still here");
    const removed = await ctx.call(
      org.users.owner,
      "DELETE",
      deletePath(project, current),
    );
    expect(removed.status).toBe(204);
    expect((await summary(project)).systemCount).toBe(0);
  });
});

describe("System permissions", () => {
  it("lets a maintainer write, shows members the System and answers 403, 404 and 401 as for rows", async () => {
    const project = await newProject(
      "matrix",
      [HEADER, GOOD("Billing API")].join("\n"),
    );
    const system = await systemNamed(project, "Billing API");
    const writes = (
      user: string | null,
      target = project,
      organization = org.id,
    ) => [
      ctx.call(
        user,
        "POST",
        systemsPath(target, organization),
        newSystem("Cache"),
      ),
      ctx.call(
        user,
        "PATCH",
        `${systemsPath(target, organization)}/${system.id}`,
        {
          name: "Renamed",
          revision: system.revision,
        },
      ),
      ctx.call(user, "DELETE", deletePath(target, system, organization)),
    ];
    const statuses = async (calls: ReturnType<typeof writes>) =>
      (await Promise.all(calls)).map((response) => response.status);

    // A Project member who is not a maintainer reads the page's data and cannot write.
    expect(await statuses(writes(org.users.viewer))).toEqual([403, 403, 403]);
    const read = await ctx.call(org.users.viewer, "GET", base(project));
    expect(read.status).toBe(200);
    expect(inventorySummarySchema.parse(read.json).canUpload).toBe(false);
    // An Organization member outside the Project cannot see it.
    expect(await statuses(writes(org.users.auditor))).toEqual([404, 404, 404]);
    expect(
      (await ctx.call(org.users.auditor, "GET", base(project))).status,
    ).toBe(404);
    // Nobody is signed in.
    expect(await statuses(writes(null))).toEqual([401, 401, 401]);
    // Another Organization's owner reaches nothing.
    expect(
      (await statuses(writes(otherOrg.users.owner))).every(
        (status) => status === 403,
      ),
    ).toBe(true);
    // A Project that does not exist.
    expect(
      (
        await ctx.call(
          org.users.owner,
          "POST",
          systemsPath(crypto.randomUUID()),
          newSystem("Cache"),
        )
      ).status,
    ).toBe(404);
    // A malformed body.
    expect(
      (
        await ctx.call(org.users.owner, "POST", systemsPath(project), {
          name: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.call(
          org.users.owner,
          "DELETE",
          `${systemPath(project, system.id)}?revision=1`,
        )
      ).status,
    ).toBe(400);
    // Nothing above changed the data.
    expect(await summary(project)).toMatchObject({
      systemCount: 1,
      totalRows: 1,
    });
    expect((await summary(project)).systems[0]).toMatchObject({
      name: "Billing API",
      revision: system.revision,
    });

    for (const user of [projectAdmin, org.users.owner, org.users.admin]) {
      const current = await systemNamed(
        project,
        (await summary(project)).systems[0]?.name ?? "",
      );
      const ok = await ctx.call(user, "PATCH", systemPath(project, system.id), {
        name: `By ${user.slice(0, 4)}`,
        revision: current.revision,
      });
      expect(ok.status).toBe(200);
    }
    // Another Project of the same Organization never reaches this System.
    const other = await newProject(
      "matrix-other",
      [HEADER, GOOD("HR Portal")].join("\n"),
    );
    const foreign = await ctx.call(
      org.users.owner,
      "PATCH",
      systemPath(other, system.id),
      {
        name: "Hijack",
        revision: 1,
      },
    );
    expect(foreign.status).toBe(409);
    expect((await summary(other)).systems.map((item) => item.name)).toEqual([
      "HR Portal",
    ]);
  });
});

describe("System writers together", () => {
  it("keeps one System per name when creates, renames and imports race for the same name", async () => {
    for (let round = 0; round < 4; round += 1) {
      const project = await newProject(
        `race-${String(round)}`,
        [HEADER, GOOD("Billing API"), GOOD("Payroll")].join("\n"),
      );
      const billing = await systemNamed(project, "Billing API");
      const results = await Promise.all([
        ctx.call(
          org.users.owner,
          "POST",
          systemsPath(project),
          newSystem("Shared Name"),
        ),
        ctx.call(
          org.users.admin,
          "POST",
          systemsPath(project),
          newSystem("shared name"),
        ),
        ctx.call(projectAdmin, "PATCH", systemPath(project, billing.id), {
          name: " SHARED NAME ",
          revision: billing.revision,
        }),
        upload(
          [HEADER, GOOD("shared Name", "24.04.1")].join("\n"),
          "race.csv",
          project,
        ),
      ]);
      for (const response of results) {
        // A refusal is a clean 409 or a stale answer, never a server error.
        expect([200, 201, 409]).toContain(response.status);
      }
      const keys = (await summary(project)).systems.map((system) =>
        system.name.trim().toLowerCase(),
      );
      expect(keys.filter((key) => key === "shared name")).toHaveLength(1);
      expect(new Set(keys).size).toBe(keys.length);
      const stored = await ctx.owner.sql.query<{
        total: number;
        usable: number;
      }>(
        `select s.total_rows as total, s.usable_rows as usable from inventory_systems s
         where s.project_id = $1 and s.name_key = 'shared name'`,
        [project],
      );
      const counted = await ctx.owner.sql.query<{ total: number }>(
        `select count(*)::int as total from inventory_rows r join inventory_systems s on s.id = r.system_id
         where s.project_id = $1 and s.name_key = 'shared name'`,
        [project],
      );
      expect(counted.rows[0]?.total).toBe(stored.rows[0]?.total);
    }
  });

  it("keeps counters and rows consistent when a delete and a row write race on one System", async () => {
    for (let round = 0; round < 3; round += 1) {
      const project = await newProject(
        `race-delete-${String(round)}`,
        [HEADER, GOOD("Billing API")].join("\n"),
      );
      const system = await systemNamed(project, "Billing API");
      const [removed, added] = await Promise.all([
        ctx.call(org.users.owner, "DELETE", deletePath(project, system)),
        ctx.call(org.users.admin, "POST", `${base(project)}/rows`, {
          systemId: system.id,
          ...fields(),
        }),
      ]);
      // Either the row came first and the delete saw another count, or the System was gone.
      if (added.status === 201) expect(removed.status).toBe(409);
      else {
        expect(removed.status).toBe(204);
        expect(added.status).toBe(404);
      }
      const left = await summary(project);
      expect(
        left.systems.every((item) => item.totalRows === left.totalRows),
      ).toBe(true);
      expect((await rows(project)).length).toBe(left.totalRows);
    }
  });
});

// Results of the F-020 scan and VEX seeded for every product of the Project.
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
    const version = mapping.product === "Redis" ? "7.2.4" : "22.04.4";
    const unit = await ctx.owner.sql.query<{ id: string }>(
      `insert into vulnerability_units (tenant_id, project_id, run_id, mapping_id, version, cpe, status)
       values ($1, $2, $3, $4, $5, 'cpe:2.3:a:v:p:*:*:*:*:*:*:*:*', 'done') returning id`,
      [org.id, project, run.rows[0]?.id, mapping.id, version],
    );
    await ctx.owner.sql.query(
      `insert into vulnerability_matches (tenant_id, project_id, unit_id, cve_id, sources)
       values ($1, $2, $3, 'CVE-2024-0001', array['nvd'])`,
      [org.id, project, unit.rows[0]?.id],
    );
    for (const table of ["vulnerability_triage", "vulnerability_triage_log"]) {
      await ctx.owner.sql.query(
        `insert into ${table} (tenant_id, project_id, mapping_id, version, cve_id, status, changed_by)
         values ($1, $2, $3, $4, 'CVE-2024-0001', 'affected', 'u')`,
        [org.id, project, mapping.id, version],
      );
    }
  }
}

const resultCounts = async (project: string) =>
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
