import type { Monitor } from "@nightwatch/api-contract";

import { Card, CardHeader } from "../../../components/ui/card";
import {
  formatNumber,
  formatTimeOrDate,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "../format";
import {
  AssertionTable,
  assertionRowFromResult,
  type AssertionRow,
} from "./AssertionTable";
import { OUTCOME_LABELS, tlsReasonLabel } from "./labels";

export function failureText(
  result: NonNullable<Monitor["lastResult"]>,
): string | null {
  if (result.failureReason === null) return null;
  if (result.failureReason === "tls_invalid") {
    const reason = tlsReasonLabel(result.tlsReason);
    return reason === null
      ? "ใบรับรองไม่ถูกต้อง"
      : `ใบรับรองไม่ถูกต้อง: ${reason}`;
  }
  return incidentReasonLabel(result.failureReason);
}

// The status code is not an assertion in the payload, so its row is derived from the result.
function statusRow(
  monitor: Monitor,
  result: NonNullable<Monitor["lastResult"]>,
): AssertionRow {
  const evaluated = result.httpStatus !== null;
  return {
    key: "status",
    label: "รหัสสถานะ",
    expected: monitor.expectedStatus,
    actual: evaluated ? String(result.httpStatus) : null,
    truncated: false,
    status: !evaluated
      ? "not_evaluated"
      : result.failureReason === "http_status"
        ? "fail"
        : "pass",
    reason: evaluated ? null : "ไม่มี response",
  };
}

export function LastResultCard({ monitor }: { monitor: Monitor }) {
  const result = monitor.lastResult;
  const cause = result === null ? null : failureText(result);
  // Result and config line up by index only while they belong to the same config version.
  const sameConfig = result?.configVersion === monitor.version;
  return (
    <Card as="section" aria-labelledby="detail-last-result">
      <CardHeader
        id="detail-last-result"
        title="ผลการตรวจล่าสุดและ Assertions"
        description={`เวลาแสดงตามเขตเวลา ${TIME_ZONE}`}
        className="border-b border-foreground/10 p-4"
      />
      <div className="flex flex-col gap-3 p-4">
        {result === null ? (
          <p className="text-sm text-foreground-secondary">ยังไม่มีผลการตรวจ</p>
        ) : (
          <>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">
                {OUTCOME_LABELS[result.outcome]}
              </span>
              <span>
                ตรวจเมื่อ{" "}
                <Time iso={result.checkedAt} format={formatTimeOrDate} />
              </span>
              {result.httpStatus === null ? null : (
                <span>HTTP {result.httpStatus}</span>
              )}
              {result.responseTimeMs === null ? null : (
                <span>ตอบสนอง {formatNumber(result.responseTimeMs)} ms</span>
              )}
              {cause === null ? null : <span>สาเหตุ {cause}</span>}
            </p>
            <p className="font-mono text-xs break-all text-foreground-secondary">
              {result.url}
            </p>
            {result.evaluatedFromPrefix ? (
              <p className="text-xs text-foreground-secondary">
                ประเมินจากเนื้อหาส่วนต้นที่อ่านได้เท่านั้น
              </p>
            ) : null}
            <AssertionTable
              caption="ผลการตรวจล่าสุดต่อเงื่อนไข"
              rows={[
                statusRow(monitor, result),
                ...result.assertions.map((item, index) => {
                  const configured = sameConfig
                    ? monitor.assertions[index]
                    : undefined;
                  return assertionRowFromResult(
                    item,
                    index,
                    configured?.kind === "jsonPathEquals" &&
                      item.kind === "jsonPathEquals"
                      ? configured.path
                      : null,
                  );
                }),
              ]}
            />
          </>
        )}
      </div>
    </Card>
  );
}
