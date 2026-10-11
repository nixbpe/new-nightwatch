import type { ReactNode } from "react";
import type { MonitorListResponse } from "@nightwatch/api-contract";
import { Link } from "react-router";

import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import { HealthPill } from "./HealthPill";
import {
  formatNumber,
  formatPercent,
  formatTimeOrDate,
  HEALTH_REASON_LABELS,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "./format";
import { IntervalText } from "./detail/IntervalText";
import { SslLabel } from "./SslLabel";

type Row = MonitorListResponse["monitors"][number];

export const NO_DATA = "ไม่มีข้อมูล";

// The line under the pill says why a state holds; "ล้มเหลว N ครั้ง" is a warning beside a health that has not changed.
export function StatusDetail({ row }: { row: Row }) {
  const lines: ReactNode[] = [];
  if (row.health === "down" && row.openIncident !== null) {
    lines.push(
      <span
        data-testid="monitor-list-incident"
        data-reason={row.openIncident.reason}
        key="incident"
      >
        ตั้งแต่{" "}
        <Time
          testId="monitor-list-incident-time"
          iso={row.openIncident.startedAt}
          format={formatTimeOrDate}
        />{" "}
        สาเหตุ {incidentReasonLabel(row.openIncident.reason)}
      </span>,
    );
  }
  if (row.health === "unknown") {
    if (row.healthReason === "stale" && row.lastCheckAt !== null) {
      lines.push(
        <span
          data-testid="monitor-list-reason"
          data-health-reason={row.healthReason}
          key="reason"
        >
          {HEALTH_REASON_LABELS.stale}ตั้งแต่{" "}
          <Time
            testId="monitor-list-reason-time"
            iso={row.lastCheckAt}
            format={formatTimeOrDate}
          />
        </span>,
      );
    } else if (row.healthReason !== null) {
      lines.push(
        <span
          data-testid="monitor-list-reason"
          data-health-reason={row.healthReason}
          key="reason"
        >
          {HEALTH_REASON_LABELS[row.healthReason]}
        </span>,
      );
    }
    if (row.lastKnownDown) {
      lines.push(
        <span data-testid="monitor-list-last-known-down" key="down">
          ล่าสุดทราบว่าล่ม
        </span>,
      );
    }
  }
  const failing =
    row.consecutiveFailures > 0 &&
    (row.health === "up" ||
      (row.health === "unknown" && row.healthReason === null));
  if (failing) {
    lines.push(
      <span
        data-testid="monitor-list-failures"
        key="failures"
        className="font-medium text-caution"
      >
        ล้มเหลว {row.consecutiveFailures} ครั้ง
      </span>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-col text-xs text-foreground-secondary">
      {lines}
    </span>
  );
}

export function Uptime({ window }: { window: Row["uptime"]["h24"] }) {
  if (window.percent === null)
    return <span className="whitespace-nowrap">{NO_DATA}</span>;
  return (
    <span className="flex flex-col whitespace-nowrap">
      <span data-testid="monitor-list-uptime-value" className="font-mono">
        {formatPercent(window.percent)}%
      </span>
      {window.coveragePercent < 100 ? (
        <span
          data-testid="monitor-list-coverage"
          className="text-xs text-foreground-secondary"
        >
          ครอบคลุม {formatPercent(window.coveragePercent)}%
        </span>
      ) : null}
    </span>
  );
}

export function MonitorTable({
  organizationId,
  monitors,
}: {
  organizationId: string;
  monitors: Row[];
}) {
  const columns: DataTableColumn<Row>[] = [
    {
      key: "health",
      header: `สถานะ (${TIME_ZONE})`,
      cell: (row) => (
        <span className="flex flex-col items-start py-1.5">
          <HealthPill testId="monitor-list-health" health={row.health} />
          <StatusDetail row={row} />
        </span>
      ),
    },
    {
      key: "name",
      header: "ชื่อ",
      cell: (row) => (
        <Link
          data-testid={`monitor-list-name-${row.id}`}
          to={`/organizations/${organizationId}/monitors/${row.id}`}
          className="block min-w-32 max-w-[240px] font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "url",
      header: "URL",
      mono: true,
      cell: (row) => (
        <span title={row.url} className="block max-w-[160px] truncate">
          {row.url}
        </span>
      ),
    },
    {
      key: "method",
      header: "เมธอด",
      mono: true,
      cell: (row) => row.method,
    },
    {
      key: "interval",
      header: "รอบตรวจ",
      cell: (row) => (
        <span className="whitespace-nowrap">
          <IntervalText seconds={row.intervalSeconds} />
        </span>
      ),
    },
    {
      key: "h24",
      header: "24 ชม.",
      cell: (row) => <Uptime window={row.uptime.h24} />,
    },
    {
      key: "d30",
      header: "30 วัน",
      cell: (row) => <Uptime window={row.uptime.d30} />,
    },
    {
      key: "responseTime",
      header: "ตอบสนอง",
      align: "end",
      cell: (row) =>
        row.lastResponseTimeMs === null ? (
          <span className="whitespace-nowrap">{NO_DATA}</span>
        ) : (
          <span className="font-mono whitespace-nowrap tabular-nums">
            {formatNumber(row.lastResponseTimeMs)} ms
          </span>
        ),
    },
    {
      key: "ssl",
      header: "SSL",
      cell: (row) => (
        <SslLabel
          testId="monitor-list-ssl"
          level={row.ssl.level}
          daysRemaining={row.ssl.daysRemaining}
          className="whitespace-nowrap"
        />
      ),
    },
    {
      key: "lastCheck",
      header: `ตรวจล่าสุด (${TIME_ZONE})`,
      cell: (row) =>
        row.lastCheckAt === null ? (
          <span className="whitespace-nowrap">{NO_DATA}</span>
        ) : (
          <Time
            testId="monitor-list-check-time"
            iso={row.lastCheckAt}
            format={formatTimeOrDate}
          />
        ),
    },
  ];
  return (
    <DataTable
      data-testid="monitor-overview-table-region"
      tableTestId="monitor-overview-table"
      rowTestId={(row) => `monitor-list-row-${row.id}`}
      cellTestId={(column) => `monitor-list-cell-${column.key}`}
      columnHeaderTestId={(column) => `monitor-list-heading-${column.key}`}
      ariaLabel="ตารางมอนิเตอร์"
      columns={columns}
      rows={monitors}
      rowKey={(row) => row.id}
    />
  );
}
