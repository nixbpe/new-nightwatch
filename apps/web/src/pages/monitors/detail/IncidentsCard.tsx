import type { MonitorIncidentsResponse } from "@nightwatch/api-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import {
  DataTable,
  DataTablePagination,
  type DataTableColumn,
} from "../../../components/ui/data-table";
import { SectionHeader } from "../../../components/ui/section-header";
import { StatusPill } from "../../../components/ui/status-pill";
import {
  fetchMonitorIncidents,
  MONITOR_HISTORY_PAGE_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import {
  formatDateTime,
  formatDuration,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "../format";
import { EventFeedMockup } from "./MonitorDetailMockups";

type Incident = MonitorIncidentsResponse["incidents"][number];

const columns: DataTableColumn<Incident>[] = [
  {
    key: "start",
    header: `เริ่ม (${TIME_ZONE})`,
    cell: (row) => <Time iso={row.startedAt} format={formatDateTime} />,
  },
  {
    key: "end",
    header: "สิ้นสุด",
    cell: (row) =>
      row.endedAt === null ? (
        <span className="flex flex-wrap items-center gap-2">
          ยังไม่สิ้นสุด
          <StatusPill tone="danger" neutralLabel>
            กำลังเกิดอยู่
          </StatusPill>
        </span>
      ) : (
        <span className="flex flex-col">
          <Time iso={row.endedAt} format={formatDateTime} />
          {row.endReason === null ? null : (
            <span className="text-xs text-foreground-secondary">
              {incidentReasonLabel(row.endReason)}
            </span>
          )}
        </span>
      ),
  },
  {
    key: "duration",
    header: "ระยะเวลา",
    cell: (row) => formatDuration(row.durationSeconds),
  },
  {
    key: "reason",
    header: "สาเหตุ",
    cell: (row) => (
      <span>
        {incidentReasonLabel(row.startReason)}
        {row.startHttpStatus === null
          ? null
          : ` (HTTP ${String(row.startHttpStatus)})`}
      </span>
    ),
  },
];

// Independent query: a failure stays inside this card.
export function IncidentsCard({
  organizationId,
  monitorId,
  code,
}: {
  code?: string;
  organizationId: string;
  monitorId: string;
}) {
  const [offset, setOffset] = useState(0);
  const page = { limit: MONITOR_HISTORY_PAGE_SIZE, offset };
  const incidents = useQuery({
    queryKey: monitorQueryKeys.incidents(organizationId, monitorId, page),
    queryFn: () => fetchMonitorIncidents(organizationId, monitorId, page),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  });
  const data = incidents.data;
  return (
    <section aria-labelledby="detail-incidents" className="flex flex-col gap-4">
      <SectionHeader
        id="detail-incidents"
        code={code}
        title="เหตุการณ์"
        meta={<>เวลาแสดงตามเขตเวลา {TIME_ZONE}</>}
      />
      <div className="flex flex-col gap-3">
        {data === undefined && incidents.isError ? (
          <>
            <Alert tone="error">โหลดเหตุการณ์ไม่สำเร็จ</Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void incidents.refetch()}
            >
              ลองอีกครั้ง
            </Button>
          </>
        ) : null}
        {data === undefined && !incidents.isError ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <p role="status" className="sr-only">
              กำลังโหลดเหตุการณ์
            </p>
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        ) : null}
        {data !== undefined && data.page.total === 0 ? (
          <p className="text-sm text-foreground-secondary">
            ไม่มีเหตุการณ์ล่มในช่วงที่มีข้อมูล
          </p>
        ) : null}
        {data !== undefined && data.page.total > 0 ? (
          <>
            <DataTable
              ariaLabel="ตารางเหตุการณ์"
              columns={columns}
              rows={data.incidents}
              rowKey={(row) => row.id}
            />
            <DataTablePagination
              ariaLabel="หน้าเหตุการณ์"
              summary={
                <>
                  แสดง {data.page.offset + 1}–
                  {data.page.offset + data.incidents.length} จาก{" "}
                  {data.page.total}
                </>
              }
              previousLabel="ก่อนหน้า"
              nextLabel="ถัดไป"
              hasPrevious={data.page.offset > 0}
              hasNext={
                data.page.offset + data.incidents.length < data.page.total
              }
              onPrevious={() => {
                setOffset(Math.max(0, offset - MONITOR_HISTORY_PAGE_SIZE));
              }}
              onNext={() => {
                setOffset(offset + MONITOR_HISTORY_PAGE_SIZE);
              }}
            />
          </>
        ) : null}
        {data !== undefined && incidents.isError ? (
          <Alert tone="warning">อัปเดตเหตุการณ์ไม่สำเร็จ</Alert>
        ) : null}
      </div>
      <EventFeedMockup />
    </section>
  );
}
