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

// The dash is the visible mark of a missing value; the sentence is for screen readers.
export function NoData() {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{NO_DATA}</span>
    </span>
  );
}

export function Uptime({ window }: { window: Row["uptime"]["h24"] }) {
  if (window.percent === null) return <NoData />;
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
  projectId,
  monitors,
}: {
  organizationId: string;
  projectId: string;
  monitors: Row[];
}) {
  const columns: DataTableColumn<Row>[] = [
    {
      key: "name",
      header: "มอนิเตอร์",
      cell: (row) => (
        <span className="flex min-w-40 max-w-[320px] flex-col py-1.5">
          <Link
            data-testid={`monitor-list-name-${row.id}`}
            to={`/organizations/${organizationId}/projects/${projectId}/monitors/${row.id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.name}
          </Link>
          <span
            data-testid="monitor-list-url"
            title={row.url}
            className="truncate font-mono text-xs text-foreground-secondary"
          >
            {row.url}
          </span>
        </span>
      ),
    },
    {
      key: "health",
      header: "สถานะ",
      cell: (row) => (
        <span className="flex flex-col items-start py-1.5">
          <HealthPill testId="monitor-list-health" health={row.health} />
          <StatusDetail row={row} />
        </span>
      ),
    },
    {
      key: "p95",
      header: "เวลาตอบสนอง · p95 · 24 ชม.",
      align: "end",
      cell: (row) =>
        row.responseP95Ms24h === null ? (
          <NoData />
        ) : (
          <span
            data-testid="monitor-list-p95-value"
            className="font-mono whitespace-nowrap tabular-nums"
          >
            {formatNumber(row.responseP95Ms24h)} ms
          </span>
        ),
    },
    {
      key: "h24",
      header: "ความพร้อมใช้งาน · 24 ชม.",
      cell: (row) => <Uptime window={row.uptime.h24} />,
    },
    {
      key: "lastCheck",
      header: `ตรวจล่าสุด (${TIME_ZONE})`,
      cell: (row) =>
        row.lastCheckAt === null ? (
          <NoData />
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
