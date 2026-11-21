import { z } from "zod";

import { inventoryMappingCountsSchema } from "./inventory";

// Browser-safe (PKG-01): zod only. The review dialog validates a typed CPE or purl
// with the same schemas the API parses requests with (F-018 S2.1 to S2.3).

// CPE 2.3 formatted string: cpe:2.3:<part>:<vendor>:<product>:<version>:<update>:
// <edition>:<language>:<sw_edition>:<target_sw>:<target_hw>:<other>. A component is
// non-empty and a colon inside it is written \:.
export const CPE_NAME_PATTERN =
  /^cpe:2\.3:[aho](?::(?:\\.|[^:\\\s]){1,128}){10}$/;
export const cpeNameSchema = z.string().max(512).regex(CPE_NAME_PATTERN);

// package-url: pkg:<type>/<namespace and name>[@version][?qualifiers][#subpath].
export const PURL_PATTERN = /^pkg:[a-z][a-z0-9.+-]*\/[^\s/][^\s]*$/;
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
