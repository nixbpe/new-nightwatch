import { z } from "zod";

import { inventoryMappingCountsSchema } from "./inventory";

// Browser-safe (PKG-01): zod only. The review dialog validates a typed CPE or purl
// with the same schemas the API parses requests with (F-018 S2.1 to S2.3).

// CPE 2.3 formatted string: cpe:2.3:<part>:<vendor>:<product>:<version>:<update>:
// <edition>:<language>:<sw_edition>:<target_sw>:<target_hw>:<other>. A component is
// non-empty and a colon inside it is written \:.
export const CPE_NAME_PATTERN =
  /^cpe:2\.3:[aho](?::(?:\\.|[^:\\\s]){1,128}){10}$/;
export const cpeNameSchema = z
  .string()
  .max(512)
  .regex(CPE_NAME_PATTERN)
  .refine((value) => !/\p{Cc}/u.test(value));

/**
 * A mapping names a product, not a release: the inventory row supplies the version
 * when F-019 matches. A dictionary name carries one (`...:17.1.1.3:...`), and storing
 * it would make a confirmed CPE miss every other version, so the version and the
 * eight components after it become `*`.
 */
export function productCpe(cpe: string): string {
  // A backslash escapes the next character, so `\:` stays inside a component and a
  // component can end in `\\` before the delimiter.
  const parts: string[] = [];
  let part = "";
  for (let i = 0; i < cpe.length; i += 1) {
    const char = cpe.charAt(i);
    if (char === "\\") {
      part += char + cpe.charAt(i + 1);
      i += 1;
    } else if (char === ":") {
      parts.push(part);
      part = "";
    } else part += char;
  }
  parts.push(part);
  return parts.length === 13
    ? [...parts.slice(0, 5), ...Array<string>(8).fill("*")].join(":")
    : cpe;
}

/**
 * A purl without its `@version`. The version is the `@` after the last `/` of the
 * path (before any `?` or `#`), so an unencoded scope such as `pkg:npm/@angular/core`
 * and an `@` in a qualifier are left alone. Callers check the result with `purlSchema`.
 */
export function productPurl(purl: string): string {
  const end = purl.search(/[?#]/);
  const path = end === -1 ? purl : purl.slice(0, end);
  const rest = end === -1 ? "" : purl.slice(end);
  const at = path.indexOf("@", path.lastIndexOf("/") + 1);
  return (at === -1 ? path : path.slice(0, at)) + rest;
}

// package-url: pkg:<type>/<namespace and name>[@version][?qualifiers][#subpath].
export const PURL_PATTERN =
  /^pkg:[a-z][a-z0-9.+-]*\/(?:[^\s/?#]+\/)*[^\s/@?#]+(?:@[^\s/?#]+)?(?:\?[^\s#]+)?(?:#[^\s]+)?$/;
export const purlSchema = z
  .string()
  .max(512)
  .regex(PURL_PATTERN)
  .refine((value) => !/\p{Cc}/u.test(value));

export const mappingStatusSchema = z.enum(["pending", "confirmed", "unmapped"]);
export type MappingStatus = z.infer<typeof mappingStatusSchema>;

export const mappingSourceSchema = z.enum(["central", "nvd", "manual"]);

export const inventoryMappingSchema = z.object({
  id: z.uuid(),
  vendor: z.string(),
  product: z.string(),
  status: mappingStatusSchema,
  cpe: z.string().nullable(),
  purl: z.string().nullable(),
  /** 0 to 1; null when the identifier was typed by hand or there is none. */
  confidence: z.number().min(0).max(1).nullable(),
  source: mappingSourceSchema.nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  /** Usable inventory rows that use this vendor and product. */
  rows: z.number().int().nonnegative(),
  /** Up to five System names that use it. */
  systems: z.array(z.string()),
});
export type InventoryMapping = z.infer<typeof inventoryMappingSchema>;

export const inventoryMappingListQuerySchema = z.object({
  status: mappingStatusSchema.optional(),
});

export const inventoryMappingListSchema = z.object({
  canManage: z.boolean(),
  counts: inventoryMappingCountsSchema,
  items: z.array(inventoryMappingSchema),
});
export type InventoryMappingList = z.infer<typeof inventoryMappingListSchema>;

export const inventoryMappingUpdateSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("confirm"),
    /** Omitted to confirm the suggestion already stored on the mapping. */
    cpe: cpeNameSchema.optional(),
    purl: purlSchema.optional(),
  }),
  z.strictObject({ action: z.literal("unmapped") }),
]);
export type InventoryMappingUpdate = z.infer<
  typeof inventoryMappingUpdateSchema
>;

export const cpeSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export const cpeCandidateSchema = z.object({
  cpe: z.string(),
  title: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type CpeCandidate = z.infer<typeof cpeCandidateSchema>;

export const cpeSearchResultSchema = z.object({
  candidates: z.array(cpeCandidateSchema),
});

export const inventoryMappingSuggestionSchema = z.object({
  item: inventoryMappingSchema,
  candidates: z.array(cpeCandidateSchema),
});
