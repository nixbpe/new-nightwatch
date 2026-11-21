import { describe, expect, it } from "vitest";

import {
  cpeNameSchema,
  inventoryMappingUpdateSchema,
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
