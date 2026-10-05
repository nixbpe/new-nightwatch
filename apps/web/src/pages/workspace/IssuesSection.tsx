import { Link } from "react-router";

import { initialsFontClass, initialsOf } from "../../components/shell/initials";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatDuration,
  formatTimeOrDate,
  incidentReasonLabel,
  Time,
} from "../monitors/format";
import { HEALTH_LABELS } from "../monitors/HealthPill";
import { sslDaysText, sslText } from "../monitors/SslLabel";
import { hasSslWarning, type MonitorRow } from "./rows";

// Down monitors first, then SSL warnings; the list endpoint order holds within each group.
export function problemRows(monitors: MonitorRow[]): MonitorRow[] {
  return [
    ...monitors.filter((row) => row.health === "down"),
    ...monitors.filter((row) => row.health !== "down" && hasSslWarning(row)),
  ];
}

function IssueRow({
  organizationId,
  row,
  now,
}: {
  organizationId: string;
  row: MonitorRow;
  now: number;
}) {
  const initials = initialsOf(row.name);
  const down = row.health === "down";
  const ssl = hasSslWarning(row);
  const incident = row.openIncident;
  const sslDays = sslDaysText(row.ssl.level, row.ssl.daysRemaining);
  const elapsed =
    down && incident !== null
      ? Math.max(0, Math.floor((now - Date.parse(incident.startedAt)) / 1000))
      : null;
  return (
    <Link
      to={`/organizations/${organizationId}/monitors/${row.id}`}
      className="grid grid-cols-[44px_minmax(0,1fr)] gap-4 p-5 text-foreground hover:surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:grid-cols-[44px_minmax(0,1fr)_170px]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-11 place-items-center rounded-[4px] border border-foreground/20 text-xs font-semibold text-foreground-secondary",
          initialsFontClass(initials),
        )}
      >
        {initials}
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <b className="text-[15px] font-semibold text-heading">{row.name}</b>
          {down ? (
            <StatusPill tone="danger" neutralLabel>
              {HEALTH_LABELS.down}
            </StatusPill>
          ) : null}
          {ssl ? (
            <StatusPill
              tone={row.ssl.level === "caution" ? "caution" : "danger"}
              neutralLabel
            >
              {sslText(row.ssl.level, row.ssl.daysRemaining)}
            </StatusPill>
          ) : null}
        </span>
        <span className="font-mono text-xs break-all text-foreground-secondary">
          {row.url}
        </span>
        {down && incident !== null ? (
          <span className="text-[13px]">
            {incidentReasonLabel(incident.reason)}
            {row.consecutiveFailures > 0 ? (
              <>
                {" · ล้มเหลว "}
                <span className="font-mono">{row.consecutiveFailures}</span>
                {" ครั้ง"}
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="col-start-2 flex flex-col gap-1 text-[13px] text-foreground-secondary sm:col-start-auto sm:items-end sm:text-right">
        {down && incident !== null ? (
          <>
            <span>ล่มตั้งแต่</span>
            <b className="font-mono font-medium text-foreground">
              <Time iso={incident.startedAt} format={formatTimeOrDate} />
            </b>
            {elapsed === null ? null : (
              <span className="text-xs">{formatDuration(elapsed)}</span>
            )}
          </>
        ) : null}
        {!down && ssl && sslDays !== null ? (
          <b className="font-medium text-foreground">{sslDays}</b>
        ) : null}
        {!down && ssl && row.ssl.issuer !== null ? (
          <span className="min-w-0 break-words text-xs">
            ผู้ออก {row.ssl.issuer}
          </span>
        ) : null}
        {!down && ssl && row.ssl.notAfter !== null ? (
          <span className="text-xs">
            หมดอายุ{" "}
            <time dateTime={row.ssl.notAfter}>
              {formatDate(row.ssl.notAfter)}
            </time>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function IssuesSection({
  organizationId,
  monitors,
  now,
}: {
  organizationId: string;
  monitors: MonitorRow[];
  now: number;
}) {
  const rows = problemRows(monitors);
  return (
    <section aria-labelledby="overview-issues" className="flex flex-col">
      <SectionHeader
        id="overview-issues"
        code="01"
        title="ต้องดูตอนนี้"
        meta={
          <>
            <span>
              <span className="font-mono">{rows.length}</span> รายการ
            </span>
            <Link
              to={`/organizations/${organizationId}/monitors`}
              className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              ดูทั้งหมด →
            </Link>
          </>
        }
      />
      {rows.length === 0 ? (
        <p className="border-b border-foreground/10 py-6 text-sm text-foreground-secondary">
          ไม่มีมอนิเตอร์ที่ล่มหรือมี SSL ใกล้หมดอายุ
        </p>
      ) : (
        <HairlineGrid as="ul" className="rounded-t-none border-t-0">
          {rows.map((row) => (
            <li key={row.id}>
              <IssueRow organizationId={organizationId} row={row} now={now} />
            </li>
          ))}
        </HairlineGrid>
      )}
    </section>
  );
}
