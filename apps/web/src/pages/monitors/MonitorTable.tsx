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
  formatTimeOrDate,
  HEALTH_REASON_LABELS,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "./format";
import { SslLabel } from "./SslLabel";

type Row = MonitorListResponse["monitors"][number];

export const NO_DATA = "ไม่มีข้อมูล";

// The line under the pill says why a state holds; "ล้มเหลว N ครั้ง" is a warning beside a health that has not changed.
export function StatusDetail({ row }: { row: Row }) {
  const lines: ReactNode[] = [];
  if (row.health === "down" && row.openIncident !== null) {
    lines.push(
      <span key="incident">
        ตั้งแต่{" "}
        <Time iso={row.openIncident.startedAt} format={formatTimeOrDate} />{" "}
        สาเหตุ {incidentReasonLabel(row.openIncident.reason)}
      </span>,
    );
  }
  if (row.health === "unknown") {
    if (row.healthReason === "stale" && row.lastCheckAt !== null) {
      lines.push(
        <span key="reason">
          {HEALTH_REASON_LABELS.stale}ตั้งแต่{" "}
          <Time iso={row.lastCheckAt} format={formatTimeOrDate} />
        </span>,
      );
    } else if (row.healthReason !== null) {
      lines.push(
        <span key="reason">{HEALTH_REASON_LABELS[row.healthReason]}</span>,
      );
    }
    if (row.lastKnownDown) {
      lines.push(<span key="down">ล่าสุดทราบว่าล่ม</span>);
    }
  }
  const failing =
    row.consecutiveFailures > 0 &&
    (row.health === "up" ||
      (row.health === "unknown" && row.healthReason === null));
  if (failing) {
    lines.push(
      <span key="failures" className="font-medium text-caution">
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
  if (window.percent === null) return <span>{NO_DATA}</span>;
  return (
    <span className="flex flex-col">
      <span className="font-mono">{formatNumber(window.percent)}%</span>
      {window.coveragePercent < 100 ? (
        <span className="text-xs text-foreground-secondary">
          ครอบคลุม {formatNumber(window.coveragePercent)}%
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
          <HealthPill health={row.health} />
          <StatusDetail row={row} />
        </span>
      ),
    },
    {
      key: "name",
      header: "ชื่อ",
      cell: (row) => (
        <Link
          to={`/organizations/${organizationId}/monitors/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
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
        <span title={row.url} className="block max-w-[320px] truncate">
          {row.url}
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
          <span>{NO_DATA}</span>
        ) : (
          <span className="font-mono tabular-nums">
            {formatNumber(row.lastResponseTimeMs)} ms
          </span>
        ),
    },
    {
      key: "ssl",
      header: "SSL",
      cell: (row) => (
        <SslLabel level={row.ssl.level} daysRemaining={row.ssl.daysRemaining} />
      ),
    },
    {
      key: "lastCheck",
      header: `ตรวจล่าสุด (${TIME_ZONE})`,
      cell: (row) =>
        row.lastCheckAt === null ? (
          <span>{NO_DATA}</span>
        ) : (
          <Time iso={row.lastCheckAt} format={formatTimeOrDate} />
        ),
    },
  ];
  return (
    <DataTable
      ariaLabel="ตารางมอนิเตอร์"
      columns={columns}
      rows={monitors}
      rowKey={(row) => row.id}
    />
  );
}
