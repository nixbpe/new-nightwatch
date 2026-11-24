import {
  cpeSearchResultSchema,
  inventoryImportListSchema,
  inventoryImportPendingSchema,
  inventoryImportPreviewSchema,
  inventoryImportResultSchema,
  inventoryMappingListSchema,
  inventoryMappingSchema,
  inventoryMappingSuggestionSchema,
  inventoryRowInvalidDetailsSchema,
  inventoryRowListSchema,
  inventoryRowSchema,
  inventorySummarySchema,
  inventorySystemSchema,
  type InventoryImportsQuery,
  type InventoryIssue,
  type InventoryMappingUpdate,
  type InventoryRowCreate,
  type InventoryRowInput,
  type InventoryRowsQuery,
  type InventorySystemCreate,
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
const systems = `${base}/systems` as const;
const system = `${systems}/{systemId}` as const;
const rejectedExport = `${system}/rejected-rows/export` as const;
const projectExport = `${base}/export` as const;
const systemExport = `${system}/export` as const;
const rows = `${base}/rows` as const;
const row = `${rows}/{rowId}` as const;
const previews = `${base}/import-previews` as const;
const currentPreview = `${previews}/current` as const;
const preview = `${previews}/{previewId}` as const;
const imports = `${base}/imports` as const;
const mappings = `${base}/mappings` as const;
const mapping = `${mappings}/{mappingId}` as const;

// Every key sits under TENANT_QUERY_PREFIX so switching Organization removes it (WEB-03).
export const inventoryKeys = {
  all: (organizationId: string, projectId: string) =>
    [...TENANT_QUERY_PREFIX, "inventory", organizationId, projectId] as const,
  summary: (organizationId: string, projectId: string) =>
    [...inventoryKeys.all(organizationId, projectId), "summary"] as const,
  allRows: (organizationId: string, projectId: string) =>
    [...inventoryKeys.all(organizationId, projectId), "rows"] as const,
  rows: (
    organizationId: string,
    projectId: string,
    query: InventoryRowsQuery,
  ) => [...inventoryKeys.allRows(organizationId, projectId), query] as const,
  mappings: (organizationId: string, projectId: string) =>
    [...inventoryKeys.all(organizationId, projectId), "mappings"] as const,
  importPreview: (organizationId: string, projectId: string) =>
    [
      ...inventoryKeys.all(organizationId, projectId),
      "import-preview",
    ] as const,
  imports: (organizationId: string, projectId: string, page: number) =>
    [...inventoryKeys.all(organizationId, projectId), "imports", page] as const,
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

/** Reads the file into a preview; nothing is merged until the preview is confirmed. */
export function createImportPreview(
  organizationId: string,
  projectId: string,
  file: File,
  signal?: AbortSignal,
) {
  return requestUpload(previews, inventoryImportPreviewSchema, {
    params: { organizationId, projectId },
    file,
    signal,
  });
}

export function fetchImportPreview(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return request(currentPreview, inventoryImportPendingSchema, {
    params: { organizationId, projectId },
    signal,
  });
}

export function confirmImport(
  organizationId: string,
  projectId: string,
  previewId: string,
) {
  return request(`${preview}/confirm`, inventoryImportResultSchema, {
    method: "POST",
    params: { organizationId, projectId, previewId },
  });
}

export function cancelImportPreview(
  organizationId: string,
  projectId: string,
  previewId: string,
) {
  return request(preview, undefined, {
    method: "DELETE",
    params: { organizationId, projectId, previewId },
  });
}

export function fetchRows(
  organizationId: string,
  projectId: string,
  query: InventoryRowsQuery,
  signal?: AbortSignal,
) {
  return request(rows, inventoryRowListSchema, {
    params: { organizationId, projectId },
    query,
    signal,
  });
}

export function fetchImports(
  organizationId: string,
  projectId: string,
  query: InventoryImportsQuery,
  signal?: AbortSignal,
) {
  return request(imports, inventoryImportListSchema, {
    params: { organizationId, projectId },
    query,
    signal,
  });
}

export function createRow(
  organizationId: string,
  projectId: string,
  body: InventoryRowCreate,
) {
  return request(rows, inventoryRowSchema, {
    method: "POST",
    params: { organizationId, projectId },
    body,
  });
}

export function updateRow(
  organizationId: string,
  projectId: string,
  rowId: string,
  body: InventoryRowInput & { revision: number },
) {
  return request(row, inventoryRowSchema, {
    method: "PUT",
    params: { organizationId, projectId, rowId },
    body,
  });
}

export function deleteRow(
  organizationId: string,
  projectId: string,
  rowId: string,
  revision: number,
) {
  return request(row, undefined, {
    method: "DELETE",
    params: { organizationId, projectId, rowId },
    query: { revision },
  });
}

export function createSystem(
  organizationId: string,
  projectId: string,
  body: InventorySystemCreate,
) {
  return request(systems, inventorySystemSchema, {
    method: "POST",
    params: { organizationId, projectId },
    body,
  });
}

export function renameSystem(
  organizationId: string,
  projectId: string,
  systemId: string,
  body: { name: string; revision: number },
) {
  return request(system, inventorySystemSchema, {
    method: "PATCH",
    params: { organizationId, projectId, systemId },
    body,
  });
}

export function deleteSystem(
  organizationId: string,
  projectId: string,
  target: { id: string; revision: number; totalRows: number },
) {
  return request(system, undefined, {
    method: "DELETE",
    params: { organizationId, projectId, systemId: target.id },
    query: { revision: target.revision, rows: target.totalRows },
  });
}

export function downloadRejectedRows(
  organizationId: string,
  projectId: string,
  systemId: string,
  signal?: AbortSignal,
): Promise<DownloadedFile> {
  return requestFile(rejectedExport, {
    params: { organizationId, projectId, systemId },
    signal,
  });
}

/** The Project's inventory, or one System's when `systemId` is given, as the template workbook. */
export function downloadInventory(
  organizationId: string,
  projectId: string,
  systemId?: string,
  signal?: AbortSignal,
): Promise<DownloadedFile> {
  return systemId === undefined
    ? requestFile(projectExport, {
        params: { organizationId, projectId },
        signal,
      })
    : requestFile(systemExport, {
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

/** The message the page shows for a failed read, import or save. */
export function inventoryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === "INVENTORY_FILE_REJECTED" ||
      error.code === "INVENTORY_ROW_INVALID" ||
      error.code === "INVENTORY_ROW_DUPLICATE" ||
      error.code === "INVENTORY_ROW_STALE" ||
      error.code === "INVENTORY_SYSTEM_NAME_TAKEN" ||
      error.code === "INVENTORY_SYSTEM_STALE" ||
      error.code === "INVENTORY_PREVIEW_NOT_FOUND" ||
      error.code === "INVENTORY_PREVIEW_EXPIRED" ||
      error.code === "INVENTORY_PREVIEW_STALE" ||
      error.code === "INVENTORY_EXPORT_TOO_LARGE" ||
      error.code === "INVENTORY_EXPORT_STALE_ROWS" ||
      error.code === "CPE_DICTIONARY_UNAVAILABLE" ||
      error.code === "MAPPING_IDENTIFIER_REQUIRED"
    ) {
      return error.message;
    }
    if (error.status === 403) return "เฉพาะผู้ดูแลโปรเจกต์ทำรายการนี้ได้";
    if (error.status === 404) return "ไม่พบข้อมูลที่ขอ หรือคุณเข้าถึงไม่ได้";
    if (error.status === 429) return "ทำรายการบ่อยเกินไป โปรดลองใหม่ภายหลัง";
    if (error.status === 503) return "บริการ inventory ยังไม่พร้อม";
  }
  return "ทำรายการไม่สำเร็จ โปรดลองใหม่";
}

/** The columns a save was refused for, with the code an import would have given them. */
export function inventoryRowIssues(error: unknown): InventoryIssue[] {
  if (!(error instanceof ApiError) || error.code !== "INVENTORY_ROW_INVALID") {
    return [];
  }
  const details = inventoryRowInvalidDetailsSchema.safeParse(error.details);
  return details.success ? details.data.issues : [];
}

export const INVENTORY_DENIED_MESSAGE =
  "คุณไม่มีสิทธิ์ดู inventory ของโปรเจกต์นี้";

export function isInventoryAccessDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}
