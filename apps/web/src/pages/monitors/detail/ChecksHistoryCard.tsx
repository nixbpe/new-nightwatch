import type { MonitorChecksResponse } from "@nightwatch/api-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Card, CardHeader } from "../../../components/ui/card";
import {
  DataTable,
  DataTablePagination,
  type DataTableColumn,
} from "../../../components/ui/data-table";
import { StatusPill } from "../../../components/ui/status-pill";
import {
  fetchMonitorChecks,
  MONITOR_HISTORY_PAGE_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import { formatDateTime, formatNumber, Time, TIME_ZONE } from "../format";
import { AssertionTable, assertionRowFromResult } from "./AssertionTable";
import { failureText } from "./LastResultCard";
import { assertionSummary, OUTCOME_LABELS } from "./labels";

type Check = MonitorChecksResponse["checks"][number];
type Row = { check: Check; urlChanged: boolean };

const OUTCOME_TONES = {
  pass: "neutral",
  fail: "danger",
  check_error: "muted",
} as const;

/**
 * A URL change is marked on the first result at or after it. The oldest row of
 * a page has no older neighbour here, so the list of changes above the table
 * is what covers a change that falls between two pages.
 */
function markUrlChanges(
  checks: Check[],
  urlChanges: MonitorChecksResponse["urlChanges"],
): Row[] {
  return checks.map((check, index) => {
    const older = checks[index + 1];
    const at = new Date(check.checkedAt).getTime();
    const olderAt =
      older === undefined ? null : new Date(older.checkedAt).getTime();
    return {
      check,
      urlChanged: urlChanges.some((change) => {
        const changedAt = new Date(change.at).getTime();
        return changedAt <= at && olderAt !== null && changedAt > olderAt;
      }),
    };
  });
}

const columns: DataTableColumn<Row>[] = [
  {
    key: "time",
    header: `เวลา (${TIME_ZONE})`,
    cell: ({ check, urlChanged }) => (
      <span className="flex flex-col py-1.5">
        <Time iso={check.checkedAt} format={formatDateTime} />
        {urlChanged ? (
          <span className="mt-1 flex flex-col items-start gap-1">
            <StatusPill tone="caution">เปลี่ยน URL</StatusPill>
            <span className="font-mono text-xs break-all text-foreground-secondary">
              {check.url}
            </span>
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "outcome",
    header: "ผล",
    cell: ({ check }) => (
      <StatusPill tone={OUTCOME_TONES[check.outcome]} dot>
        {OUTCOME_LABELS[check.outcome]}
      </StatusPill>
    ),
  },
  {
    key: "http",
    header: "HTTP",
    mono: true,
    cell: ({ check }) => check.httpStatus ?? "–",
  },
  {
    key: "response",
    header: "ตอบสนอง",
    align: "end",
    cell: ({ check }) =>
      check.responseTimeMs === null ? (
        "–"
      ) : (
        <span className="tabular-nums">
          {formatNumber(check.responseTimeMs)} ms
        </span>
      ),
  },
  {
    key: "assertions",
    header: "Assertions",
    cell: ({ check }) => {
      const summary = assertionSummary(check.assertions);
      if (summary === null) return "–";
      return (
        <details>
          <summary className="cursor-pointer">{summary}</summary>
          <div className="mt-2">
            <AssertionTable
              caption={`Assertions ของผลตรวจ ${formatDateTime(check.checkedAt)}`}
              rows={check.assertions.map((item, index) =>
                assertionRowFromResult(item, index),
              )}
            />
          </div>
        </details>
      );
    },
  },
  {
    key: "reason",
    header: "สาเหตุ",
    cell: ({ check }) => failureText(check) ?? "–",
  },
];

// Independent query: a failure stays inside this card.
export function ChecksHistoryCard({
  organizationId,
  monitorId,
}: {
  organizationId: string;
  monitorId: string;
}) {
  const [offset, setOffset] = useState(0);
  const page = { limit: MONITOR_HISTORY_PAGE_SIZE, offset };
  const checks = useQuery({
    queryKey: monitorQueryKeys.checks(organizationId, monitorId, page),
    queryFn: () => fetchMonitorChecks(organizationId, monitorId, page),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });
  const data = checks.data;
  return (
    <Card as="section" aria-labelledby="detail-checks">
      <CardHeader
        id="detail-checks"
        title="ประวัติการตรวจ"
        description={`เวลาแสดงตามเขตเวลา ${TIME_ZONE}`}
        className="border-b border-foreground/10 p-4"
      />
      <div className="flex flex-col gap-3 p-4">
        {data === undefined && checks.isError ? (
          <>
            <Alert tone="error">โหลดประวัติการตรวจไม่สำเร็จ</Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void checks.refetch()}
            >
              ลองอีกครั้ง
            </Button>
          </>
        ) : null}
        {data === undefined && !checks.isError ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <p role="status" className="sr-only">
              กำลังโหลดประวัติการตรวจ
            </p>
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        ) : null}
        {data !== undefined && data.page.total === 0 ? (
          <p className="text-sm text-foreground-secondary">ยังไม่มีผลการตรวจ</p>
        ) : null}
        {data !== undefined && data.page.total > 0 ? (
          <>
            {data.urlChanges.length === 0 ? null : (
              <ul className="flex flex-col gap-1 text-xs text-foreground-secondary">
                {data.urlChanges.map((change) => (
                  <li key={change.at}>
                    เปลี่ยน URL เมื่อ{" "}
                    <Time iso={change.at} format={formatDateTime} /> เป็น{" "}
                    <span className="font-mono break-all">{change.url}</span>
                  </li>
                ))}
              </ul>
            )}
            <DataTable
              ariaLabel="ตารางประวัติการตรวจ"
              columns={columns}
              rows={markUrlChanges(data.checks, data.urlChanges)}
              rowKey={({ check }) => check.scheduledFor}
            />
            <DataTablePagination
              ariaLabel="หน้าประวัติการตรวจ"
              summary={
                <>
                  แสดง {data.page.offset + 1}–
                  {data.page.offset + data.checks.length} จาก {data.page.total}
                </>
              }
              previousLabel="ก่อนหน้า"
              nextLabel="ถัดไป"
              hasPrevious={data.page.offset > 0}
              hasNext={data.page.offset + data.checks.length < data.page.total}
              onPrevious={() => {
                setOffset(Math.max(0, offset - MONITOR_HISTORY_PAGE_SIZE));
              }}
              onNext={() => {
                setOffset(offset + MONITOR_HISTORY_PAGE_SIZE);
              }}
            />
          </>
        ) : null}
        {data !== undefined && checks.isError ? (
          <Alert tone="warning">อัปเดตประวัติการตรวจไม่สำเร็จ</Alert>
        ) : null}
      </div>
    </Card>
  );
}
