import {
  FALSE_POSITIVE_LIMIT,
  FALSE_POSITIVE_MIN_REVIEWED,
} from "@nightwatch/api-contract";

import { Alert } from "../../components/ui";
import { percent } from "./format";

/** The warning every member sees, and the admin sees on the sample page, once the limit is passed. */
export function FalsePositiveAlert({
  rate,
  reviewed,
  testId,
}: {
  rate: number;
  reviewed: number;
  testId: string;
}) {
  return (
    <Alert tone="warning" data-testid={testId}>
      false positive {percent(rate)} เกินเกณฑ์ {percent(FALSE_POSITIVE_LIMIT)}{" "}
      (ตรวจแล้ว {reviewed} รายการ เกณฑ์เริ่มใช้เมื่อตรวจแล้วอย่างน้อย{" "}
      {FALSE_POSITIVE_MIN_REVIEWED} รายการ) ผล match ของ Project นี้อาจมี CVE
      ที่ไม่เกี่ยวข้องมากกว่าที่ยอมรับ
    </Alert>
  );
}
