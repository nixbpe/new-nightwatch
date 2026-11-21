import {
  inventoryMappingListSchema,
  inventoryMappingSchema,
  inventorySummarySchema,
  type InventoryMapping,
} from "@nightwatch/api-contract";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openMonitorTestContext,
  type MonitorTestContext,
  type TestOrganization,
} from "../monitors/test-support";
import { createRedisClient } from "../rate-limit";
import { suggestMapping } from "./mappings";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for mapping tests");

const HEADER = "System,Owner,Vendor,Product,Version,Layer,Environment,Exposure";
const line = (
  system: string,
  vendor: string,
  product: string,
  version = "1.2.3",
) => `${system},ทีม A,${vendor},${product},${version},OS,Production,Internal`;
const REDIS_RELEASE = "cpe:2.3:a:redis:redis:7.2.4:*:*:*:*:*:*:*";
const REDIS = "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*";

let ctx: MonitorTestContext;
let redis: Redis;
let org: TestOrganization;
let otherOrg: TestOrganization;
let projectId: string;
let secondProject: string;
let outsider: string;
const run = crypto.randomUUID().slice(0, 8);
const catalogVendor = `catalogco${run}`;

const path = (suffix = "", project = projectId, organization = org.id) =>
  `/api/organizations/${organization}/projects/${project}/inventory${suffix}`;

function upload(userId: string | null, csv: string, project = projectId) {
  const boundary = "----nightwatch-boundary";
  const text =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="inventory.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
  return ctx.call(userId, "POST", path("", project), undefined, {
    text,
    contentType: `multipart/form-data; boundary=${boundary}`,
  });
}

async function mappings(userId: string, project = projectId) {
  const response = await ctx.call(userId, "GET", path("/mappings", project));
  expect(response.status).toBe(200);
  return inventoryMappingListSchema.parse(response.json);
}

function find(items: InventoryMapping[], vendor: string, product: string) {
  const item = items.find(
    (candidate) => candidate.vendor === vendor && candidate.product === product,
  );
  if (!item) throw new Error(`mapping ${vendor} ${product} missing`);
  return item;
}

const decide = (
  userId: string | null,
  mappingId: string,
  body: unknown,
  project = projectId,
) => ctx.call(userId, "PUT", path(`/mappings/${mappingId}`, project), body);

beforeAll(async () => {
  redis = createRedisClient(redisUrl);
  ctx = await openMonitorTestContext({ redis, defaultProject: true });
  org = await ctx.createOrganization("mapping-a");
  otherOrg = await ctx.createOrganization("mapping-b");
  projectId = org.projectId;
  secondProject = await ctx.createProject(org.id, "mapping-second", []);
  outsider = await ctx.createUser("mapping-outsider");
  await ctx.owner.sql.query(
    "insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')",
    [crypto.randomUUID(), org.id, outsider],
  );
  await ctx.owner.sql.query(
    "insert into catalog_product_mappings (vendor_key, product_key, cpe) values ($1, 'widget', $2)",
    [catalogVendor, "cpe:2.3:a:catalogco:widget:*:*:*:*:*:*:*:*"],
  );
}, 120_000);

afterAll(async () => {
  await ctx.owner.sql.query(
    "delete from catalog_product_mappings where vendor_key = $1",
    [catalogVendor],
  );
  // Only this suite's keys: other suites share the Redis and the global NVD key.
  const keys = [
    ...(await redis.keys(`rl:inventory-upload:u:*:p:${projectId}`)),
    ...(await redis.keys(`rl:nvd-cpe:u:*:p:${projectId}`)),
    `rl:inventory-upload:o:${org.id}`,
  ];
  await redis.del(...keys);
  await ctx.close();
  redis.disconnect();
});

describe("mappings created by an upload", () => {
  it("makes one pending mapping per vendor and product pair of the usable rows", async () => {
    const response = await upload(
      org.users.owner,
      [
        HEADER,
        line("Billing API", "F5", "BIG-IP LTM", "17.1.1.3"),
        line("HR Portal", "f5", " big-ip  ltm ", "17.1.1.4"),
        line("HR Portal", "Redis", "Redis", "7.2.4"),
        line("HR Portal", "Rejected", "Only In Bad Row", "latest"),
      ].join("\n"),
    );
    expect(response.status).toBe(200);
    expect(inventorySummarySchema.parse(response.json).mappings).toEqual({
      pending: 2,
      confirmed: 0,
      unmapped: 0,
    });
    const { items, counts } = await mappings(org.users.viewer);
    expect(counts).toEqual({ pending: 2, confirmed: 0, unmapped: 0 });
    expect(items.map((item) => item.vendor).sort()).toEqual(["F5", "Redis"]);
    expect(find(items, "F5", "BIG-IP LTM")).toMatchObject({
      status: "pending",
      cpe: null,
      rows: 2,
      systems: ["Billing API", "HR Portal"],
    });
  });

  it("confirms a pair from the operator catalog without asking again", async () => {
    await upload(
      org.users.owner,
      [HEADER, line("Catalog System", catalogVendor, "Widget")].join("\n"),
    );
    const { items } = await mappings(org.users.owner);
    expect(find(items, catalogVendor, "Widget")).toMatchObject({
      status: "confirmed",
      source: "central",
      cpe: "cpe:2.3:a:catalogco:widget:*:*:*:*:*:*:*:*",
    });
  });
});

describe("review decisions", () => {
  it("confirms a typed CPE or purl, records it and refuses a malformed one", async () => {
    const { items } = await mappings(org.users.owner);
    const redisItem = find(items, "Redis", "Redis");
    const bad = await decide(org.users.owner, redisItem.id, {
      action: "confirm",
      cpe: "cpe:/a:redis:redis",
    });
    expect(bad.status).toBe(400);
    // The dictionary names one release; the mapping keeps the product.
    const ok = await decide(org.users.owner, redisItem.id, {
      action: "confirm",
      cpe: REDIS_RELEASE,
    });
    expect(ok.status).toBe(200);
    expect(inventoryMappingSchema.parse(ok.json)).toMatchObject({
      status: "confirmed",
      cpe: REDIS,
      source: "manual",
      confidence: null,
    });
    const audit = await ctx.owner.sql.query(
      "select actor_user_id from audit_events where tenant_id = $1 and action = 'organization.project.inventory.mapping.update'",
      [org.id],
    );
    expect(audit.rows).toEqual([{ actor_user_id: org.users.owner }]);
  });

  it("keeps a suggestion's source when the identifier on screen is confirmed, and takes a different one as typed", async () => {
    const { items } = await mappings(org.users.owner);
    const gadget = find(items, "F5", "BIG-IP LTM");
    await ctx.owner.sql.query(
      "update inventory_mappings set cpe = $2, confidence = 0.7, source = 'nvd' where id = $1",
      [gadget.id, "cpe:2.3:a:acme:gadget:*:*:*:*:*:*:*:*"],
    );
    const same = await decide(org.users.owner, gadget.id, {
      action: "confirm",
      cpe: "cpe:2.3:a:acme:gadget:1.0:*:*:*:*:*:*:*",
    });
    expect(inventoryMappingSchema.parse(same.json)).toMatchObject({
      status: "confirmed",
      source: "nvd",
      confidence: 0.7,
    });
    await ctx.owner.sql.query(
      "update inventory_mappings set status = 'pending', confirmed_at = null, confirmed_by = null, cpe = $2 where id = $1",
      [gadget.id, "cpe:2.3:a:acme:gadget_pro:*:*:*:*:*:*:*:*"],
    );
    // The reviewer saw gadget, but the stored suggestion became gadget_pro meanwhile.
    const other = await decide(org.users.owner, gadget.id, {
      action: "confirm",
      cpe: "cpe:2.3:a:acme:gadget:*:*:*:*:*:*:*:*",
    });
    expect(inventoryMappingSchema.parse(other.json)).toMatchObject({
      cpe: "cpe:2.3:a:acme:gadget:*:*:*:*:*:*:*:*",
      source: "manual",
      confidence: null,
    });
    await ctx.owner.sql.query(
      "update inventory_mappings set status = 'pending', cpe = null, purl = null, confidence = null, source = null, confirmed_at = null, confirmed_by = null where id = $1",
      [gadget.id],
    );
  });

  it("keeps a typed purl for the product and refuses one left without a name", async () => {
    const { items } = await mappings(org.users.owner);
    const target = find(items, "F5", "BIG-IP LTM");
    const ok = await decide(org.users.owner, target.id, {
      action: "confirm",
      purl: "pkg:npm/@angular/core@16.0.0",
    });
    expect(inventoryMappingSchema.parse(ok.json)).toMatchObject({
      status: "confirmed",
      purl: "pkg:npm/@angular/core",
      cpe: null,
    });
    const bad = await decide(org.users.owner, target.id, {
      action: "confirm",
      purl: "pkg:deb/@1.0",
    });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({
      error: { code: "MAPPING_IDENTIFIER_INVALID" },
    });
    await ctx.owner.sql.query(
      "update inventory_mappings set status = 'pending', cpe = null, purl = null, confidence = null, source = null, confirmed_at = null, confirmed_by = null where id = $1",
      [target.id],
    );
  });

  it("refuses a CPE with a control character with 400, not 500", async () => {
    const { items } = await mappings(org.users.owner);
    const response = await decide(
      org.users.owner,
      find(items, "F5", "BIG-IP LTM").id,
      {
        action: "confirm",
        cpe: "cpe:2.3:a:acme:gad\u0000get:*:*:*:*:*:*:*:*",
      },
    );
    expect(response.status).toBe(400);
  });

  it("needs an identifier to confirm and clears it for unmapped", async () => {
    const { items } = await mappings(org.users.owner);
    const f5 = find(items, "F5", "BIG-IP LTM");
    const empty = await decide(org.users.owner, f5.id, { action: "confirm" });
    expect(empty.status).toBe(400);
    expect(empty.json).toMatchObject({
      error: { code: "MAPPING_IDENTIFIER_REQUIRED" },
    });
    const none = await decide(org.users.owner, f5.id, { action: "unmapped" });
    expect(inventoryMappingSchema.parse(none.json)).toMatchObject({
      status: "unmapped",
      cpe: null,
      purl: null,
    });
    expect((await mappings(org.users.owner)).counts).toMatchObject({
      unmapped: 1,
    });
  });

  it("lets only a Project admin decide, and hides the Project from others", async () => {
    const { items } = await mappings(org.users.owner);
    const target = find(items, "Redis", "Redis");
    const asMember = await decide(org.users.viewer, target.id, {
      action: "unmapped",
    });
    expect(asMember.status).toBe(403);
    expect((await mappings(org.users.viewer)).canManage).toBe(false);
    expect((await mappings(org.users.owner)).canManage).toBe(true);
    expect(
      (await decide(outsider, target.id, { action: "unmapped" })).status,
    ).toBe(404);
    // A user of another Organization is refused as a non-member.
    expect(
      (await decide(otherOrg.users.owner, target.id, { action: "unmapped" }))
        .status,
    ).toBe(403);
    expect((await decide(null, target.id, { action: "unmapped" })).status).toBe(
      401,
    );
    expect(
      (await mappings(org.users.owner)).items.find(
        (item) => item.id === target.id,
      )?.status,
    ).toBe("confirmed");
  });

  it("does not reach a mapping through another Project's path", async () => {
    const { items } = await mappings(org.users.owner);
    const response = await decide(
      org.users.owner,
      find(items, "Redis", "Redis").id,
      { action: "unmapped" },
      secondProject,
    );
    expect(response.status).toBe(404);
    expect(response.json).toMatchObject({
      error: { code: "INVENTORY_MAPPING_NOT_FOUND" },
    });
  });
});

describe("a later upload", () => {
  it("keeps decisions, adds new pairs as pending and drops pairs no row uses", async () => {
    await upload(
      org.users.owner,
      [
        HEADER,
        line("Billing API", "F5", "BIG-IP LTM", "17.1.1.9"),
        line("HR Portal", "Redis", "Redis", "7.2.5"),
        line("HR Portal", "Acme", "Gadget", "3.1.4"),
      ].join("\n"),
    );
    const { items } = await mappings(org.users.owner);
    expect(find(items, "F5", "BIG-IP LTM").status).toBe("unmapped");
    expect(find(items, "Redis", "Redis")).toMatchObject({
      status: "confirmed",
      cpe: REDIS,
    });
    expect(find(items, "Acme", "Gadget").status).toBe("pending");
    expect(items.some((item) => item.vendor === catalogVendor)).toBe(true);
  });

  it("copies a versioned catalog row to the Project as a product-level identifier", async () => {
    const vendor = `versioned${run}`;
    await ctx.owner.sql.query(
      "insert into catalog_product_mappings (vendor_key, product_key, cpe, purl) values ($1, 'thing', 'cpe:2.3:a:ver:thing:1.2.3:*:*:*:*:*:*:*', 'pkg:deb/ubuntu/thing@1.2.3?distro=ubuntu-22.04')",
      [vendor],
    );
    try {
      await upload(
        org.users.owner,
        [
          HEADER,
          line("Versioned", vendor, "Thing"),
          line("Versioned", "Acme", "Gadget"),
        ].join("\n"),
      );
      expect(
        find((await mappings(org.users.owner)).items, vendor, "Thing"),
      ).toMatchObject({
        status: "confirmed",
        source: "central",
        cpe: "cpe:2.3:a:ver:thing:*:*:*:*:*:*:*:*",
        purl: "pkg:deb/ubuntu/thing?distro=ubuntu-22.04",
      });
    } finally {
      await ctx.owner.sql.query(
        "delete from catalog_product_mappings where vendor_key = $1",
        [vendor],
      );
    }
  });

  it("confirms a pending pair when an operator adds it to the catalog", async () => {
    const vendor = `latecatalog${run}`;
    await upload(
      org.users.owner,
      [
        HEADER,
        line("Late", vendor, "Gizmo"),
        line("Late", "Acme", "Gadget"),
      ].join("\n"),
    );
    expect(
      find((await mappings(org.users.owner)).items, vendor, "Gizmo").status,
    ).toBe("pending");
    await ctx.owner.sql.query(
      "insert into catalog_product_mappings (vendor_key, product_key, cpe) values ($1, 'gizmo', 'cpe:2.3:a:late:gizmo:*:*:*:*:*:*:*:*')",
      [vendor],
    );
    try {
      await upload(
        org.users.owner,
        [
          HEADER,
          line("Late", vendor, "Gizmo"),
          line("Late", "Acme", "Gadget"),
        ].join("\n"),
      );
      expect(
        find((await mappings(org.users.owner)).items, vendor, "Gizmo"),
      ).toMatchObject({
        status: "confirmed",
        source: "central",
      });
    } finally {
      await ctx.owner.sql.query(
        "delete from catalog_product_mappings where vendor_key = $1",
        [vendor],
      );
    }
  });

  it("removes mappings with their Project", async () => {
    await upload(
      org.users.owner,
      [HEADER, line("Doomed", "Doom", "Thing")].join("\n"),
      secondProject,
    );
    expect((await mappings(org.users.owner, secondProject)).items).toHaveLength(
      1,
    );
    await ctx.owner.sql.query("delete from projects where id = $1", [
      secondProject,
    ]);
    const left = await ctx.owner.sql.query(
      "select 1 from inventory_mappings where project_id = $1",
      [secondProject],
    );
    expect(left.rowCount).toBe(0);
  });
});

describe("dictionary suggestions", () => {
  const limiter = (allowed: boolean) => ({
    consumeRateLimit: () => Promise.reject(new Error("unused")),
    consumeRateLimits: () =>
      Promise.resolve({ allowed, retryAfterSeconds: allowed ? 0 : 17 }),
  });
  const input = () => ({
    organizationId: org.id,
    projectId,
    actorUserId: org.users.owner,
  });

  it("stores the best match of a pending mapping as a suggestion and leaves it pending", async () => {
    const pending = find(
      (await mappings(org.users.owner)).items,
      "Acme",
      "Gadget",
    );
    const result = await suggestMapping(
      {
        database: ctx.runtime,
        rateLimiter: limiter(true),
        cpeSearch: () =>
          Promise.resolve([
            { cpe: "cpe:2.3:a:other:thing:1:*:*:*:*:*:*:*", title: null },
            {
              cpe: "cpe:2.3:a:acme:gadget:3.1.4:*:*:*:*:*:*:*",
              title: "Gadget",
            },
          ]),
      },
      { ...input(), mappingId: pending.id },
    );
    if ("retryAfterSeconds" in result) throw new Error("unexpected limit");
    expect(result.candidates[0]).toMatchObject({ confidence: 1 });
    expect(result.item).toMatchObject({
      status: "pending",
      cpe: "cpe:2.3:a:acme:gadget:*:*:*:*:*:*:*:*",
      confidence: 1,
      source: "nvd",
    });
  });

  it("does not overwrite a mapping that was decided", async () => {
    const decided = find(
      (await mappings(org.users.owner)).items,
      "Redis",
      "Redis",
    );
    const result = await suggestMapping(
      {
        database: ctx.runtime,
        rateLimiter: limiter(true),
        cpeSearch: () =>
          Promise.resolve([
            { cpe: "cpe:2.3:a:redis:redis_other:1:*:*:*:*:*:*:*", title: null },
          ]),
      },
      { ...input(), mappingId: decided.id },
    );
    if ("retryAfterSeconds" in result) throw new Error("unexpected limit");
    expect(result.item).toMatchObject({ status: "confirmed", cpe: REDIS });
  });

  it("answers the wait without calling the dictionary when the quota is spent", async () => {
    let calls = 0;
    const pending = find(
      (await mappings(org.users.owner)).items,
      "Acme",
      "Gadget",
    );
    const result = await suggestMapping(
      {
        database: ctx.runtime,
        rateLimiter: limiter(false),
        cpeSearch: () => {
          calls += 1;
          return Promise.resolve([]);
        },
      },
      { ...input(), mappingId: pending.id },
    );
    expect(result).toEqual({ retryAfterSeconds: 17 });
    expect(calls).toBe(0);
  });

  it("fails closed with 503 when the limiter or the search is missing", async () => {
    const pending = find(
      (await mappings(org.users.owner)).items,
      "Acme",
      "Gadget",
    );
    for (const deps of [
      { database: ctx.runtime, cpeSearch: () => Promise.resolve([]) },
      { database: ctx.runtime, rateLimiter: limiter(true) },
    ]) {
      await expect(
        suggestMapping(deps, { ...input(), mappingId: pending.id }),
      ).rejects.toMatchObject({ statusCode: 503 });
    }
  });

  it("refuses a member and a mapping of another Project for suggest and search", async () => {
    const pending = find(
      (await mappings(org.users.owner)).items,
      "Acme",
      "Gadget",
    );
    const otherProject = await ctx.createProject(
      org.id,
      "dictionary-other",
      [],
    );
    for (const [method, suffix] of [
      ["POST", "suggest"],
      ["GET", "cpe-search?q=gadget"],
    ] as const) {
      const asMember = await ctx.call(
        org.users.viewer,
        method,
        path(`/mappings/${pending.id}/${suffix}`),
      );
      expect(asMember.status).toBe(403);
      const crossProject = await ctx.call(
        org.users.owner,
        method,
        path(`/mappings/${pending.id}/${suffix}`, otherProject),
      );
      expect(crossProject.status).toBe(404);
      const outside = await ctx.call(
        outsider,
        method,
        path(`/mappings/${pending.id}/${suffix}`),
      );
      expect(outside.status).toBe(404);
    }
  });

  it("answers 429 with Retry-After once the shared NVD quota is spent", async () => {
    const pending = find(
      (await mappings(org.users.owner)).items,
      "Acme",
      "Gadget",
    );
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    try {
      for (let i = 0; i < 6; i += 1) {
        const response = await ctx.call(
          org.users.owner,
          "GET",
          path(`/mappings/${pending.id}/cpe-search?q=gadget`),
        );
        statuses.push(response.status);
        if (response.status === 429) {
          retryAfter = response.headers.get("retry-after");
          expect(response.json).toMatchObject({
            error: { code: "CPE_LOOKUP_RATE_LIMITED" },
          });
          break;
        }
      }
      expect(statuses.at(-1)).toBe(429);
      expect(Number(retryAfter)).toBeGreaterThan(0);
    } finally {
      // The key is shared with other tests: free it even when an assertion fails.
      await redis.del("rl:nvd-cpe:global");
    }
  });

  it("answers 502 in the envelope when the dictionary cannot be reached", async () => {
    const pending = find(
      (await mappings(org.users.owner)).items,
      "Acme",
      "Gadget",
    );
    const response = await ctx.call(
      org.users.owner,
      "GET",
      path(`/mappings/${pending.id}/cpe-search?q=gadget`),
    );
    expect(response.status).toBe(502);
    expect(response.json).toMatchObject({
      error: { code: "CPE_DICTIONARY_UNAVAILABLE" },
    });
    expect(
      (
        await ctx.call(
          org.users.viewer,
          "GET",
          path(`/mappings/${pending.id}/cpe-search?q=gadget`),
        )
      ).status,
    ).toBe(403);
  });
});
