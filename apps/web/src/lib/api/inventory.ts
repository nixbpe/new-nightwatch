import {
  cpeSearchResultSchema,
  inventoryMappingListSchema,
  inventoryMappingSchema,
  inventoryMappingSuggestionSchema,
  inventoryRejectedRowsSchema,
  inventorySummarySchema,
  type InventoryMappingUpdate,
} from "@nightwatch/api-contract";

import { TENANT_QUERY_PREFIX } from "../tenant/TenantProvider";
import {
  ApiError,
  request,
  requestFile,
  requestUpload,
  type DownloadedFile,
} from "./client";

const base =
  "/api/organizations/{organizationId}/projects/{projectId}/inventory";
const rejected = `${base}/systems/{systemId}/rejected-rows` as const;
const mappings = `${base}/mappings` as const;
const mapping = `${mappings}/{mappingId}` as const;

// Every key sits under TENANT_QUERY_PREFIX so switching Organization removes it (WEB-03).
export const inventoryKeys = {
  all: (organizationId: string, projectId: string) =>
    [...TENANT_QUERY_PREFIX, "inventory", organizationId, projectId] as const,
  summary: (organizationId: string, projectId: string) =>
    [...inventoryKeys.all(organizationId, projectId), "summary"] as const,
  mappings: (organizationId: string, projectId: string) =>
    [...inventoryKeys.all(organizationId, projectId), "mappings"] as const,
  rejected: (organizationId: string, projectId: string, systemId: string) =>
    [
      ...inventoryKeys.all(organizationId, projectId),
      "rejected",
      systemId,
    ] as const,
};

export function fetchInventory(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(base, inventorySummarySchema, {
    params: { organizationId, projectId },
    signal,
  });
}

export function uploadInventory(
  organizationId: string,
  projectId: string,
  file: File,
  signal?: AbortSignal,
) {
  return requestUpload(base, inventorySummarySchema, {
    params: { organizationId, projectId },
    file,
    signal,
  });
}

export function fetchRejectedRows(
  organizationId: string,
  projectId: string,
  systemId: string,
  signal?: AbortSignal,
) {
  return request(rejected, inventoryRejectedRowsSchema, {
    params: { organizationId, projectId, systemId },
    signal,
  });
}

export function downloadRejectedRows(
  organizationId: string,
  projectId: string,
  systemId: string,
  signal?: AbortSignal,
): Promise<DownloadedFile> {
  return requestFile(`${rejected}/export`, {
    params: { organizationId, projectId, systemId },
    signal,
  });
}

export function fetchMappings(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(mappings, inventoryMappingListSchema, {
    params: { organizationId, projectId },
    signal,
  });
}

export function decideMapping(
  organizationId: string,
  projectId: string,
  mappingId: string,
  body: InventoryMappingUpdate,
  signal?: AbortSignal,
) {
  return request(mapping, inventoryMappingSchema, {
    method: "PUT",
    params: { organizationId, projectId, mappingId },
    body,
    signal,
  });
}

export function suggestMapping(
  organizationId: string,
  projectId: string,
  mappingId: string,
  signal?: AbortSignal,
) {
  return request(`${mapping}/suggest`, inventoryMappingSuggestionSchema, {
    method: "POST",
    params: { organizationId, projectId, mappingId },
    signal,
  });
}

export function searchCpe(
  organizationId: string,
  projectId: string,
  mappingId: string,
  q: string,
  signal?: AbortSignal,
) {
  return request(`${mapping}/cpe-search`, cpeSearchResultSchema, {
    params: { organizationId, projectId, mappingId },
    query: { q },
    signal,
  });
}

/** The message the page shows for a failed read or upload. */
export function inventoryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === "INVENTORY_FILE_REJECTED" ||
      error.code === "CPE_DICTIONARY_UNAVAILABLE" ||
      error.code === "MAPPING_IDENTIFIER_REQUIRED"
    ) {
      return error.message;
    }
    if (error.status === 403)
      return "เฉพาะผู้ดูแลโปรเจกต์ upload inventory ได้";
    if (error.status === 404) return "ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้";
    if (error.status === 429) return "ทำรายการบ่อยเกินไป โปรดลองใหม่ภายหลัง";
    if (error.status === 503) return "บริการ inventory ยังไม่พร้อม";
  }
  return "ทำรายการไม่สำเร็จ โปรดลองใหม่";
}

export function isInventoryAccessDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}
