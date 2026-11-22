import type { InventoryRowSource } from "@nightwatch/api-contract";

import type { Preferences } from "../../lib/preferences";
import { formatUploadedAt } from "./format";

/** "import จาก <file>" or "แก้ในระบบ", the last change of a row (S7.5). */
export const sourceLabel = (source: InventoryRowSource) =>
  source.kind === "import"
    ? `import จาก ${source.fileName ?? ""}`
    : "แก้ในระบบ";

/** Who and when, in the viewer's time zone. */
export const sourceWho = (
  source: InventoryRowSource,
  preferences: Preferences,
) =>
  `${source.changedBy ?? "ผู้ใช้ที่ถูกลบแล้ว"} · ${formatUploadedAt(source.changedAt, preferences)}`;
