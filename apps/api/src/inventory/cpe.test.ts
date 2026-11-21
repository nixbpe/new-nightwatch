import { describe, expect, it } from "vitest";

import {
  type CpeName,
  cpeConfidence,
  cpeVendorProduct,
  createNvdCpeSearch,
  rankCandidates,
  type SendOutbound,
} from "./cpe";

const F5 = "cpe:2.3:a:f5:big-ip_local_traffic_manager:17.1.1.3:*:*:*:*:*:*:*";

describe("cpeVendorProduct", () => {
  it("reads vendor and product, with _ read as a space", () => {
    expect(cpeVendorProduct(F5)).toEqual([
      "f5",
      "big-ip local traffic manager",
    ]);
  });

  it("keeps an escaped colon inside a component and refuses a non-CPE", () => {
    expect(
      cpeVendorProduct("cpe:2.3:a:ven\\:dor:prod:1:*:*:*:*:*:*:*"),
    ).toEqual(["ven\\:dor", "prod"]);
    expect(cpeVendorProduct("pkg:deb/ubuntu/openssl")).toBeUndefined();
  });
});

describe("cpeConfidence", () => {
  it("is 1 for an exact vendor and product", () => {
    expect(
      cpeConfidence(
        "Redis",
        "Redis",
        "cpe:2.3:a:redis:redis:7.2.4:*:*:*:*:*:*:*",
      ),
    ).toBe(1);
  });

  it("weights the product above the vendor and ignores case and punctuation", () => {
    const productOnly = cpeConfidence(
      "Someone",
      "Big-IP Local Traffic Manager",
      F5,
    );
    const vendorOnly = cpeConfidence("F5", "Unrelated Thing", F5);
    expect(productOnly).toBe(0.6);
    expect(vendorOnly).toBe(0.4);
  });

  it("is partial for a partial product match and 0 for none or a bad name", () => {
    const partial = cpeConfidence("F5", "BIG-IP LTM", F5);
    expect(partial).toBeGreaterThan(0.4);
    expect(partial).toBeLessThan(1);
    expect(cpeConfidence("Acme", "Widget", F5)).toBe(0);
    expect(cpeConfidence("F5", "BIG-IP", "not a cpe")).toBe(0);
  });
});

describe("rankCandidates", () => {
  it("orders by confidence, then name, and keeps ten", () => {
    const names: CpeName[] = Array.from({ length: 12 }, (_, i) => ({
      cpe: `cpe:2.3:a:redis:redis${String(i).padStart(2, "0")}:1:*:*:*:*:*:*:*`,
      title: null,
    }));
    names.push({
      cpe: "cpe:2.3:a:redis:redis:7.2.4:*:*:*:*:*:*:*",
      title: "Redis",
    });
    const ranked = rankCandidates("Redis", "Redis", names);
    expect(ranked).toHaveLength(10);
    expect(ranked[0]).toMatchObject({
      cpe: "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*",
      confidence: 1,
    });
  });
});

describe("rankCandidates for a product with many releases", () => {
  it("offers each product once, without the version", () => {
    const releases = Array.from({ length: 30 }, (_, i) => ({
      cpe: `cpe:2.3:a:redis:redis:7.${String(i)}.0:*:*:*:*:*:*:*`,
      title: `Redis 7.${String(i)}.0`,
    }));
    releases.push({
      cpe: "cpe:2.3:a:redis:redis_enterprise:7.2:*:*:*:*:*:*:*",
      title: "Redis Enterprise",
    });
    const ranked = rankCandidates("Redis", "Redis", releases);
    expect(ranked.map((candidate) => candidate.cpe)).toEqual([
      "cpe:2.3:a:redis:redis:*:*:*:*:*:*:*:*",
      "cpe:2.3:a:redis:redis_enterprise:*:*:*:*:*:*:*:*",
    ]);
    expect(ranked[0]).toMatchObject({ confidence: 1, title: "Redis 7.0.0" });
  });
});

function reply(body: unknown, status = 200, truncated = false) {
  const send: SendOutbound = () =>
    Promise.resolve({
      ok: true,
      response: {
        remoteAddress: "203.0.113.1",
        httpVersion: "HTTP/1.1",
        status,
        reasonPhrase: null,
        headers: {},
        body: Buffer.from(
          typeof body === "string" ? body : JSON.stringify(body),
        ),
        bodyTruncated: truncated,
        finalUrl: "https://services.nvd.nist.gov/",
        redirects: 0,
        elapsedMs: 5,
      },
    });
  return send;
}

describe("createNvdCpeSearch", () => {
  it("asks NVD for the keyword with the outbound limits and keeps non-deprecated CPE 2.3 names", async () => {
    const seen: string[] = [];
    const search = createNvdCpeSearch({
      send: (request) => {
        seen.push(
          request.url,
          String(request.maxRedirects),
          String(request.timeoutMs),
        );
        return reply({
          products: [
            {
              cpe: {
                cpeName: F5,
                titles: [{ title: "F5 BIG-IP LTM", lang: "en" }],
              },
            },
            {
              cpe: {
                cpeName: F5.replace("17.1.1.3", "16.0"),
                deprecated: true,
              },
            },
            { cpe: { cpeName: "cpe:/a:old:style" } },
          ],
        })(request);
      },
    });

    expect(await search("big-ip ltm")).toEqual([
      { cpe: F5, title: "F5 BIG-IP LTM" },
    ]);
    const url = new URL(seen[0] ?? "");
    expect(url.origin + url.pathname).toBe(
      "https://services.nvd.nist.gov/rest/json/cpes/2.0",
    );
    expect(url.searchParams.get("keywordSearch")).toBe("big-ip ltm");
    expect(seen.slice(1)).toEqual(["0", "10000"]);
  });

  it.each([
    [
      "a failed request",
      () =>
        Promise.resolve({
          ok: false,
          failure: { reason: "timeout" as const, message: "t" },
        }),
    ],
    ["a non-200 status", reply({ products: [] }, 403)],
    ["a body that is not JSON", reply("<html>")],
    ["a body of the wrong shape", reply({ products: [{ cpe: 1 }] })],
    ["a truncated body", reply({ products: [] }, 200, true)],
  ])("answers 502 CPE_DICTIONARY_UNAVAILABLE for %s", async (_name, send) => {
    await expect(createNvdCpeSearch({ send })("x y")).rejects.toMatchObject({
      statusCode: 502,
      code: "CPE_DICTIONARY_UNAVAILABLE",
    });
  });

  it("logs only the failure reason, never the query", async () => {
    const lines: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => lines.push(args) } as never;
    await expect(
      createNvdCpeSearch({ send: reply({}, 403), logger })("secret product"),
    ).rejects.toMatchObject({ code: "CPE_DICTIONARY_UNAVAILABLE" });
    expect(JSON.stringify(lines)).toContain("status_403");
    expect(JSON.stringify(lines)).not.toContain("secret");
  });

  it("drops a dictionary name with a control character", async () => {
    const search = createNvdCpeSearch({
      send: reply({
        products: [
          { cpe: { cpeName: F5 } },
          { cpe: { cpeName: F5.replace("big-ip", "big\u0000ip") } },
        ],
      }),
    });
    expect((await search("big-ip")).map((name) => name.cpe)).toEqual([F5]);
  });

  it("treats an empty answer as no candidates", async () => {
    expect(await createNvdCpeSearch({ send: reply({}) })("nothing")).toEqual(
      [],
    );
  });
});
