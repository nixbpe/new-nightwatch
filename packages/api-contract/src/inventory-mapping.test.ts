import { describe, expect, it } from "vitest";

import {
  cpeNameSchema,
  inventoryMappingUpdateSchema,
  productCpe,
  productPurl,
  purlSchema,
} from "./inventory-mapping";

describe("cpeNameSchema", () => {
  it.each([
    "cpe:2.3:a:f5:big-ip_local_traffic_manager:17.1.1.3:*:*:*:*:*:*:*",
    "cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:lts:*:*:*",
    "cpe:2.3:a:vendor:prod\\:uct:1.0:*:*:*:*:*:*:*",
  ])("accepts %s", (value) => {
    expect(cpeNameSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["the 2.2 URI form", "cpe:/a:f5:big-ip:17.1.1"],
    ["an unknown part", "cpe:2.3:x:f5:big-ip:17.1.1:*:*:*:*:*:*:*"],
    ["too few components", "cpe:2.3:a:f5:big-ip:17.1.1"],
    ["too many components", "cpe:2.3:a:f5:big-ip:1:*:*:*:*:*:*:*:*"],
    ["an empty component", "cpe:2.3:a::big-ip:17.1.1:*:*:*:*:*:*:*"],
    ["a space", "cpe:2.3:a:f5:big ip:17.1.1:*:*:*:*:*:*:*"],
    ["a NUL", "cpe:2.3:a:f5:big\u0000ip:17.1.1:*:*:*:*:*:*:*"],
    ["a control character", "cpe:2.3:a:f5:big\u0007ip:17.1.1:*:*:*:*:*:*:*"],
    ["text before the prefix", "x cpe:2.3:a:f5:big-ip:1:*:*:*:*:*:*:*"],
  ])("rejects %s", (_name, value) => {
    expect(cpeNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("purlSchema", () => {
  it.each([
    "pkg:deb/ubuntu/openssl@3.0.2-0ubuntu1.10?distro=ubuntu-22.04",
    "pkg:npm/%40angular/core@16.0.0",
    "pkg:maven/org.apache.logging.log4j/log4j-core@2.17.1",
  ])("accepts %s", (value) => {
    expect(purlSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["no scheme", "deb/ubuntu/openssl"],
    ["no name", "pkg:deb"],
    ["an upper-case type", "pkg:DEB/ubuntu/openssl"],
    ["a space", "pkg:deb/ubuntu/open ssl"],
    ["a control character", "pkg:deb/ubuntu/open\u0000ssl"],
    ["an empty name", "pkg:deb/"],
    ["a namespaced empty name with version", "pkg:deb/ubuntu/@1.0"],
    ["a namespaced empty name", "pkg:deb/ubuntu/"],
    ["a namespaced empty name with qualifier", "pkg:deb/ubuntu/?distro=x"],
  ])("rejects %s", (_name, value) => {
    expect(purlSchema.safeParse(value).success).toBe(false);
  });
});

describe("inventoryMappingUpdateSchema", () => {
  it("takes a confirm with or without an identifier and an unmapped", () => {
    for (const body of [
      { action: "confirm" },
      { action: "confirm", purl: "pkg:deb/ubuntu/openssl" },
      { action: "unmapped" },
    ]) {
      expect(inventoryMappingUpdateSchema.safeParse(body).success).toBe(true);
    }
  });

  it("refuses an identifier on unmapped and unknown fields", () => {
    for (const body of [
      { action: "unmapped", cpe: "cpe:2.3:a:f5:big-ip:1:*:*:*:*:*:*:*" },
      { action: "confirm", extra: 1 },
      { action: "approve" },
    ]) {
      expect(inventoryMappingUpdateSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("productCpe and productPurl", () => {
  it("drops the version and what follows it from a CPE and keeps the product", () => {
    expect(
      productCpe(
        "cpe:2.3:a:f5:big-ip_local_traffic_manager:17.1.1.3:p1:enterprise:en:*:linux:x64:*",
      ),
    ).toBe("cpe:2.3:a:f5:big-ip_local_traffic_manager:*:*:*:*:*:*:*:*");
    expect(productCpe("cpe:2.3:a:ven\\:dor:prod:1:*:*:*:*:*:*:*")).toBe(
      "cpe:2.3:a:ven\\:dor:prod:*:*:*:*:*:*:*:*",
    );
  });

  it("leaves a name that is already for the product, and a string that is no CPE, alone", () => {
    const product = "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*";
    expect(productCpe(product)).toBe(product);
    expect(productCpe("not a cpe")).toBe("not a cpe");
  });

  it("reads an escaped backslash at the end of a component as the end of it", () => {
    expect(productCpe("cpe:2.3:a:ven\\\\:prod:1:*:*:*:*:*:*:*")).toBe(
      "cpe:2.3:a:ven\\\\:prod:*:*:*:*:*:*:*:*",
    );
  });

  it("leaves an unencoded scope and an @ in a qualifier or subpath alone", () => {
    expect(productPurl("pkg:npm/@angular/core@16.0.0")).toBe(
      "pkg:npm/@angular/core",
    );
    expect(productPurl("pkg:npm/@angular/core")).toBe("pkg:npm/@angular/core");
    expect(productPurl("pkg:deb/x/y?repository_url=https://u@host")).toBe(
      "pkg:deb/x/y?repository_url=https://u@host",
    );
    expect(
      productPurl("pkg:deb/x/y@1.0?repository_url=https://u@host#a@b"),
    ).toBe("pkg:deb/x/y?repository_url=https://u@host#a@b");
    expect(
      purlSchema.safeParse(productPurl("pkg:npm/@angular/core@16.0.0")).success,
    ).toBe(true);
  });

  it("can leave a purl without a name, which purlSchema refuses", () => {
    expect(purlSchema.safeParse(productPurl("pkg:deb/@1.0")).success).toBe(
      false,
    );
  });

  it("drops only the @version of a purl", () => {
    expect(
      productPurl(
        "pkg:deb/ubuntu/openssl@3.0.2-0ubuntu1.10?distro=ubuntu-22.04",
      ),
    ).toBe("pkg:deb/ubuntu/openssl?distro=ubuntu-22.04");
    expect(productPurl("pkg:npm/%40angular/core@16.0.0#sub")).toBe(
      "pkg:npm/%40angular/core#sub",
    );
    expect(productPurl("pkg:deb/ubuntu/openssl")).toBe(
      "pkg:deb/ubuntu/openssl",
    );
  });
});
