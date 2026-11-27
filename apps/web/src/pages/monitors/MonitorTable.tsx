import type { ReactNode } from "react";
import type {
  MonitorListResponse,
  MonitorListSort,
} from "@nightwatch/api-contract";
import { Link } from "react-router";

import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
  type SortDirection,
} from "../../components/ui/data-table";
import { StatusPill } from "../../components/ui/status-pill";
import { HealthPill } from "./HealthPill";
import {
  formatNumber,
  formatPercent,
  formatTimeOrDate,
  HEALTH_REASON_LABELS,
  incidentReasonLabel,
  NO_DATA,
  Time,
  timeZone,
} from "./format";
import { SslLabel, sslText } from "./SslLabel";

type Row = MonitorListResponse["monitors"][number];

// The line under the pill says why a state holds; "ล้มเหลวติดกัน N ครั้ง" is a warning beside a health that has not changed.
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
        ล้มเหลวติดกัน {row.consecutiveFailures} ครั้ง
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

export function NoData() {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{NO_DATA}</span>
    </span>
  );
}

// Cards show SSL as plain text; the table has no spare line, so a level that needs action becomes a pill.
function SslCell({ ssl }: { ssl: Row["ssl"] }) {
  if (ssl.level === "no_data") return <NoData />;
  if (
    ssl.level === "caution" ||
    ssl.level === "danger" ||
    ssl.level === "expired"
  ) {
    return (
      <StatusPill
        data-testid="monitor-list-ssl"
        data-ssl-level={ssl.level}
        data-days-remaining={ssl.daysRemaining ?? ""}
        tone={ssl.level === "caution" ? "caution" : "danger"}
        dot
      >
        {sslText(ssl.level, ssl.daysRemaining)}
      </StatusPill>
    );
  }
  return (
    <SslLabel
      testId="monitor-list-ssl"
      level={ssl.level}
      daysRemaining={ssl.daysRemaining}
      className="text-xs"
    />
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

// The list API sorts in one fixed direction per order, so each sortable column offers only that one.
const COLUMN_SORTS = {
  name: { sort: "name", direction: "asc" },
  p95: { sort: "response_time", direction: "desc" },
  h24: { sort: "uptime", direction: "asc" },
} as const satisfies Record<
  string,
  { sort: MonitorListSort; direction: SortDirection }
>;

export function MonitorTable({
  organizationId,
  projectId,
  monitors,
  sort,
  onSortChange,
}: {
  organizationId: string;
  projectId: string;
  monitors: Row[];
  sort: MonitorListSort;
  onSortChange: (sort: MonitorListSort) => void;
}) {
  const sortColumn = Object.entries(COLUMN_SORTS).find(
    ([, entry]) => entry.sort === sort,
  );
  const tableSort: DataTableSort = {
    key: sortColumn?.[0] ?? null,
    direction: sortColumn?.[1].direction ?? "asc",
    onSortChange: (key) => {
      const next = Object.entries(COLUMN_SORTS).find(([name]) => name === key);
      if (next !== undefined) onSortChange(next[1].sort);
    },
  };
  const columns: DataTableColumn<Row>[] = [
    {
      key: "name",
      header: "มอนิเตอร์",
      sortDirections: [COLUMN_SORTS.name.direction],
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
      sortDirections: [COLUMN_SORTS.p95.direction],
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
      align: "end",
      sortDirections: [COLUMN_SORTS.h24.direction],
      cell: (row) => <Uptime window={row.uptime.h24} />,
    },
    {
      key: "ssl",
      header: "SSL",
      cell: (row) => <SslCell ssl={row.ssl} />,
    },
    {
      key: "lastCheck",
      header: `ตรวจล่าสุด (${timeZone()})`,
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
      dense
      columns={columns}
      rows={monitors}
      rowKey={(row) => row.id}
      sort={tableSort}
    />
  );
}
