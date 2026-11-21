import { createDatabase, withTenantContextRaw } from "@nightwatch/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireIntegrationDatabaseUrls } from "../testing/db-integration";
import {
  parseCatalogArgs,
  upsertCatalogMapping,
} from "./catalog-product-mapping";

const CPE = "cpe:2.3:a:f5:big-ip_local_traffic_manager:*:*:*:*:*:*:*:*";
const { runtimeUrl, ownerUrl } = requireIntegrationDatabaseUrls();
const owner = createDatabase(ownerUrl);
const runtime = createDatabase(runtimeUrl);
const run = crypto.randomUUID().slice(0, 8);
const vendor = `Catalog Vendor ${run}`;
const tenant = crypto.randomUUID();

beforeAll(async () => {
  await owner.sql.query(
    "insert into organization (id, name, slug) values ($1, 'cat', $2)",
    [tenant, `cat-${tenant}`],
  );
});

afterAll(async () => {
  await owner.sql.query(
    "delete from catalog_product_mappings where vendor_key like $1",
    [`%${run}`],
  );
  await owner.sql.query("delete from organization where id = $1", [tenant]);
  await owner.close();
  await runtime.close();
});

describe("parseCatalogArgs", () => {
  it("takes flags with a space or =, and cleans the strings", () => {
    expect(
      parseCatalogArgs([
        "--vendor",
        "  F5  ",
        `--product=BIG-IP\tLTM`,
        `--cpe=${CPE}`,
      ]),
    ).toEqual({ vendor: "F5", product: "BIG-IP LTM", cpe: CPE });
  });

  it.each([
    ["no identifier", ["--vendor", "a", "--product", "b"]],
    [
      "a malformed CPE",
      ["--vendor", "a", "--product", "b", "--cpe", "cpe:/a:x:y"],
    ],
    [
      "a malformed purl",
      ["--vendor", "a", "--product", "b", "--purl", "deb/x"],
    ],
    ["a missing product", ["--vendor", "a", "--cpe", CPE]],
    [
      "a stray argument",
      ["--vendor", "a", "--product", "b", "--cpe", CPE, "extra"],
    ],
    ["a flag without a value", ["--vendor", "--product", "b", "--cpe", CPE]],
  ])("refuses %s", (_name, argv) => {
    expect(() => parseCatalogArgs(argv)).toThrow(/Usage:/);
  });
});

describe("upsertCatalogMapping", () => {
  it("writes the pair under the normalized keys and replaces it on a repeat", async () => {
    const first = await upsertCatalogMapping(owner, {
      vendor,
      product: "Widget",
      cpe: CPE,
    });
    expect(first.productKey).toBe("widget");
    await upsertCatalogMapping(owner, {
      vendor: vendor.toUpperCase(),
      product: "WIDGET",
      purl: "pkg:deb/ubuntu/widget",
    });
    const read = await withTenantContextRaw(runtime, tenant, (client) =>
      client.query(
        "select cpe, purl from catalog_product_mappings where vendor_key = $1",
        [first.vendorKey],
      ),
    );
    expect(read.rows).toEqual([{ cpe: null, purl: "pkg:deb/ubuntu/widget" }]);
  });
});
