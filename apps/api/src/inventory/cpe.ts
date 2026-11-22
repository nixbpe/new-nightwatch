import {
  CPE_NAME_PATTERN,
  cpeNameSchema,
  productCpe,
  type CpeCandidate,
} from "@nightwatch/api-contract";
import {
  sendOutboundRequest,
  type OutboundDeps,
  type OutboundRequest,
  type OutboundResult,
} from "@nightwatch/shared";
import { AppError, type Logger } from "@nightwatch/shared";
import { z } from "zod";

export type CpeName = { cpe: string; title: string | null };
export type CpeSearch = (query: string) => Promise<CpeName[]>;
export type SendOutbound = (
  request: OutboundRequest,
  deps?: OutboundDeps,
) => Promise<OutboundResult>;

const NVD_CPE_URL = "https://services.nvd.nist.gov/rest/json/cpes/2.0";
const MAX_CANDIDATES = 10;

const unavailable = () =>
  new AppError(
    502,
    "CPE_DICTIONARY_UNAVAILABLE",
    "ค้น NVD CPE dictionary ไม่ได้ในตอนนี้ โปรดลองใหม่ภายหลังหรือกรอก CPE/purl เอง",
  );

const nvdResponseSchema = z.object({
  products: z
    .array(
      z.object({
        cpe: z.object({
          cpeName: z.string(),
          deprecated: z.boolean().optional(),
          titles: z
            .array(z.object({ title: z.string(), lang: z.string() }))
            .optional(),
        }),
      }),
    )
    .default([]),
});

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token !== ""),
  );
}

function overlap(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** The vendor and product components of a CPE 2.3 name, `_` read as a space. */
export function cpeVendorProduct(cpe: string): [string, string] | undefined {
  if (!CPE_NAME_PATTERN.test(cpe)) return undefined;
  const parts = Array.from(cpe.matchAll(/(?:\\.|[^:\\])+/g), ([part]) => part);
  const vendor = parts[3];
  const product = parts[4];
  return vendor === undefined || product === undefined
    ? undefined
    : [vendor.replaceAll("_", " "), product.replaceAll("_", " ")];
}

/**
 * Word overlap between the inventory text and the CPE's vendor and product, 0 to 1,
 * product weighted above vendor. A guide for the reviewer, never a decision: every
 * mapping still waits for a person (F-018 proposal AC, Q-13 thresholds are open).
 */
export function cpeConfidence(
  vendor: string,
  product: string,
  cpe: string,
): number {
  const parts = cpeVendorProduct(cpe);
  if (!parts) return 0;
  const score =
    0.4 * overlap(vendor, parts[0]) + 0.6 * overlap(product, parts[1]);
  return Math.round(score * 100) / 100;
}

export function rankCandidates(
  vendor: string,
  product: string,
  names: CpeName[],
): CpeCandidate[] {
  // The dictionary lists one name per release, so many names are one product. A
  // mapping is for the product (productCpe), and the first title of a product is kept.
  const products = new Map<string, CpeName>();
  for (const name of names) {
    const cpe = productCpe(name.cpe);
    if (!products.has(cpe)) products.set(cpe, { cpe, title: name.title });
  }
  return [...products.values()]
    .map((name) => ({
      ...name,
      confidence: cpeConfidence(vendor, product, name.cpe),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.cpe.localeCompare(b.cpe))
    .slice(0, MAX_CANDIDATES);
}

/**
 * NVD CPE dictionary 2.0 keyword search through the shared outbound helper (OUT-01).
 * Without an API key NVD allows 5 requests per 30 seconds; the caller limits for it.
 */
export function createNvdCpeSearch(options: {
  outbound?: OutboundDeps;
  send?: SendOutbound;
  logger?: Logger;
}): CpeSearch {
  const send = options.send ?? sendOutboundRequest;
  return async (query) => {
    const url = new URL(NVD_CPE_URL);
    url.searchParams.set("keywordSearch", query);
    url.searchParams.set("resultsPerPage", "50");
    const result = await send(
      {
        url: url.toString(),
        method: "GET",
        headers: { accept: "application/json" },
        timeoutMs: 10_000,
        maxRedirects: 0,
        secretHeaderNames: [],
        maxBodyBytes: 4 * 1024 * 1024,
      },
      options.outbound,
    );
    const response = result.response;
    // Only the reason is logged: never the query text or the URL.
    const fail = (reason: string) => {
      options.logger?.warn({ reason }, "CPE dictionary request failed");
      return unavailable();
    };
    if (!result.ok || !response) {
      throw fail(result.failure?.reason ?? "no_response");
    }
    if (response.status !== 200)
      throw fail(`status_${String(response.status)}`);
    if (response.bodyTruncated) throw fail("body_truncated");
    let parsed: z.infer<typeof nvdResponseSchema>;
    try {
      parsed = nvdResponseSchema.parse(
        JSON.parse(response.body.toString("utf8")),
      );
    } catch {
      throw fail("invalid_body");
    }
    return parsed.products
      .filter((product) => product.cpe.deprecated !== true)
      .map((product) => ({
        cpe: product.cpe.cpeName,
        title:
          product.cpe.titles?.find((title) => title.lang === "en")?.title ??
          null,
      }))
      .filter((name) => cpeNameSchema.safeParse(name.cpe).success);
  };
}
