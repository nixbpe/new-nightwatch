import type { CheckAssertionResult } from "@nightwatch/api-contract";

import { CheckIcon, XIcon } from "../../../components/shell/icons";
import { formatNumber } from "../format";
import {
  ASSERTION_KIND_LABELS,
  ASSERTION_STATUS_LABELS,
  assertionReasonLabel,
} from "./labels";

export type AssertionRow = {
  key: string;
  label: string;
  expected: string;
  actual: string | null;
  truncated: boolean;
  status: CheckAssertionResult["status"];
  reason: string | null;
};

/** Every row carries the word (ผ่าน / ไม่ผ่าน / ไม่ได้ประเมิน) next to its icon (COL-01). */
export function assertionRowFromResult(
  item: CheckAssertionResult,
  index: number,
  path: string | null = null,
): AssertionRow {
  const isTime = item.kind === "responseTimeBelow";
  const unit = (value: string) =>
    isTime && !Number.isNaN(Number(value))
      ? `${formatNumber(Number(value))} ms`
      : value;
  return {
    key: `${String(index)}:${item.kind}`,
    label:
      path === null
        ? ASSERTION_KIND_LABELS[item.kind]
        : `${ASSERTION_KIND_LABELS[item.kind]} ${path}`,
    expected: unit(item.expected),
    actual: item.actual === null ? null : unit(item.actual),
    truncated: item.actualTruncated,
    status: item.status,
    reason: assertionReasonLabel(item.reason, item.actualType),
  };
}

function StatusCell({ row }: { row: AssertionRow }) {
  const tone =
    row.status === "pass"
      ? "text-primary"
      : row.status === "fail"
        ? "text-danger"
        : "text-foreground-secondary";
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${tone}`}>
      {row.status === "pass" ? <CheckIcon size={14} /> : null}
      {row.status === "fail" ? <XIcon size={14} /> : null}
      {row.status === "not_evaluated" ? (
        <span aria-hidden="true">–</span>
      ) : null}
      {ASSERTION_STATUS_LABELS[row.status]}
      {row.reason === null ? null : (
        <span className="font-normal text-foreground-secondary">
          ({row.reason})
        </span>
      )}
    </span>
  );
}

export function AssertionTable({
  caption,
  rows,
}: {
  caption: string;
  rows: AssertionRow[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-foreground-secondary">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">
              เงื่อนไข
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              คาดหวัง
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              ที่ได้จริง
            </th>
            <th scope="col" className="py-2 font-medium">
              ผล
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-foreground/10">
              <td className="py-2 pr-4">{row.label}</td>
              <td className="py-2 pr-4 font-mono text-[13px] break-all">
                {row.expected}
              </td>
              <td className="py-2 pr-4 font-mono text-[13px] break-all">
                {row.actual === null ? (
                  <span className="font-sans text-foreground-secondary">
                    ไม่มีค่า
                  </span>
                ) : (
                  row.actual
                )}
                {row.truncated ? (
                  <span className="ml-2 rounded-full border border-foreground/10 px-1.5 py-0.5 font-sans text-xs text-foreground-secondary">
                    ตัดแล้ว
                  </span>
                ) : null}
              </td>
              <td className="py-2">
                <StatusCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
