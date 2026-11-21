import { INVENTORY_QUALITY_THRESHOLD_PERCENT } from "@nightwatch/api-contract";

import { formatAuditTimestamp, type Preferences } from "../../lib/preferences";

export const NO_SYSTEM_NAME = "(ไม่ระบุชื่อ System)";

// Rounded down so a System at 94.9% never reads as having reached 95%.
export function usablePercent(usable: number, total: number): number {
  return total === 0 ? 0 : Math.floor((usable * 100) / total);
}

export const QUALITY_THRESHOLD = INVENTORY_QUALITY_THRESHOLD_PERCENT;

export function formatUploadedAt(iso: string, preferences: Preferences) {
  return formatAuditTimestamp(new Date(iso), preferences).slice(0, 16);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
