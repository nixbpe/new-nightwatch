import {
  inventoryImportPendingSchema,
  inventoryImportPreviewSchema,
  inventoryImportResultSchema,
} from "@nightwatch/api-contract";
import { expect } from "vitest";

import type { ApiResponse, MonitorTestContext } from "../monitors/test-support";

export const HEADER =
  "System,Owner,Vendor,Product,Version,Layer,Environment,Exposure";
export const GOOD = (system: string, version = "22.04.4") =>
  `${system},ทีม A,Canonical,Ubuntu,${version},OS,Production,Internal`;

export const importsPath = (organization: string, project: string) =>
  `/api/organizations/${organization}/projects/${project}/inventory/import-previews`;

export function multipart(csv: string, fileName = "inventory.csv") {
  const boundary = "----nightwatch-boundary";
  return {
    text:
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Chooses a file: the preview of it, nothing merged. */
export function previewFile(
  ctx: MonitorTestContext,
  userId: string | null,
  organization: string,
  project: string,
  csv: string,
  fileName?: string,
): Promise<ApiResponse> {
  return ctx.call(
    userId,
    "POST",
    importsPath(organization, project),
    undefined,
    multipart(csv, fileName),
  );
}

export function confirmPreview(
  ctx: MonitorTestContext,
  userId: string | null,
  organization: string,
  project: string,
  previewId: string,
): Promise<ApiResponse> {
  return ctx.call(
    userId,
    "POST",
    `${importsPath(organization, project)}/${previewId}/confirm`,
  );
}

export function cancelPreview(
  ctx: MonitorTestContext,
  userId: string | null,
  organization: string,
  project: string,
  previewId: string,
): Promise<ApiResponse> {
  return ctx.call(
    userId,
    "DELETE",
    `${importsPath(organization, project)}/${previewId}`,
  );
}

export async function pendingPreview(
  ctx: MonitorTestContext,
  userId: string | null,
  organization: string,
  project: string,
) {
  const response = await ctx.call(
    userId,
    "GET",
    `${importsPath(organization, project)}/current`,
  );
  expect(response.status).toBe(200);
  return inventoryImportPendingSchema.parse(response.json).preview;
}

/** What a fixture needs: choose the file, then confirm its preview. */
export async function importFile(
  ctx: MonitorTestContext,
  userId: string,
  organization: string,
  project: string,
  csv: string,
  fileName?: string,
) {
  const previewed = await previewFile(
    ctx,
    userId,
    organization,
    project,
    csv,
    fileName,
  );
  expect(previewed.status).toBe(201);
  const preview = inventoryImportPreviewSchema.parse(previewed.json);
  const confirmed = await confirmPreview(
    ctx,
    userId,
    organization,
    project,
    preview.id,
  );
  expect(confirmed.status).toBe(200);
  return {
    preview,
    result: inventoryImportResultSchema.parse(confirmed.json),
  };
}

/**
 * The same two steps for a fixture that only needs the Project to hold the file: the response
 * is the confirmation's, or the refused preview's.
 */
export async function importResponse(
  ctx: MonitorTestContext,
  userId: string | null,
  organization: string,
  project: string,
  csv: string,
  fileName?: string,
): Promise<ApiResponse> {
  const previewed = await previewFile(
    ctx,
    userId,
    organization,
    project,
    csv,
    fileName,
  );
  if (previewed.status !== 201) return previewed;
  return confirmPreview(
    ctx,
    userId,
    organization,
    project,
    inventoryImportPreviewSchema.parse(previewed.json).id,
  );
}
