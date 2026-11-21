import {
  INVENTORY_MAX_FILE_BYTES,
  INVENTORY_MAX_ROWS,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";

import type { FileRejection } from "./file";

const MAX_NAMES = 20;
const MAX_NAME_LENGTH = 60;

// Column names come from the uploaded file, so they are shortened and stripped
// of control characters before they are echoed back.
function names(values: readonly string[]): string {
  return values
    .slice(0, MAX_NAMES)
    .map((value) =>
      Array.from(value.replace(/\p{Cc}/gu, " "))
        .slice(0, MAX_NAME_LENGTH)
        .join(""),
    )
    .join(", ");
}

function reasonOf(rejection: FileRejection): string {
  switch (rejection.code) {
    case "columns_mismatch": {
      const parts = [];
      if (rejection.missing.length > 0) {
        parts.push(`ขาดคอลัมน์ ${names(rejection.missing)}`);
      }
      if (rejection.unexpected.length > 0) {
        parts.push(
          `มีคอลัมน์ที่ไม่อยู่ใน template: ${names(rejection.unexpected)}`,
        );
      }
      return parts.join(" และ");
    }
    case "sheet_not_found":
      return "ไม่พบ sheet ชื่อ Inventory เปลี่ยนชื่อ sheet ที่มีข้อมูลเป็น Inventory แล้ว upload ใหม่";
    case "csv_not_utf8":
      return 'อ่านไฟล์ไม่ได้ save เป็น "CSV UTF-8 (Comma delimited)" หรือใช้ .xlsx';
    case "csv_invalid":
      return "อ่านไฟล์ CSV ไม่ได้ พบเครื่องหมายคำพูดที่ไม่ปิด แก้ไฟล์แล้ว upload ใหม่";
    case "unsupported_extension":
      return "รับเฉพาะ .xlsx และ .csv";
    case "xlsx_unreadable":
      return "อ่านไฟล์ .xlsx ไม่ได้ ไฟล์อาจเสียหาย";
    case "file_too_large":
      return `ไฟล์ใหญ่เกิน ${String(INVENTORY_MAX_FILE_BYTES / (1024 * 1024))} MB`;
    case "no_rows":
      return "ไม่พบแถวข้อมูลใต้หัวคอลัมน์";
    case "too_many_rows":
      return `มีแถวเกิน ${String(INVENTORY_MAX_ROWS)} แถว แบ่งเป็นหลายไฟล์ตาม System`;
  }
}

export function inventoryFileRejected(
  fileName: string,
  rejection: FileRejection,
): AppError {
  return new AppError(
    400,
    "INVENTORY_FILE_REJECTED",
    `ไฟล์ ${names([fileName])} ถูกปฏิเสธ ไม่มีข้อมูลใดถูกนำเข้า: ${reasonOf(rejection)}`,
    { reason: rejection.code },
  );
}
