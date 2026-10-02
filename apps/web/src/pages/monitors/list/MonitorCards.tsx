import type { MonitorListResponse } from "@nightwatch/api-contract";
import { Link } from "react-router";

import {
  initialsFontClass,
  initialsOf,
} from "../../../components/shell/initials";
import { HairlineGrid } from "../../../components/ui/hairline-grid";
import { cn } from "../../../lib/utils";
import { formatNumber, formatTimeOrDate, Time, TIME_ZONE } from "../format";
import { HealthPill } from "../HealthPill";
import { NO_DATA, StatusDetail, Uptime } from "../MonitorTable";
import { SslLabel } from "../SslLabel";

type Row = MonitorListResponse["monitors"][number];

// Cards view of the same list page as the table: two columns on a hairline grid.
// The name stays its own link so its accessible name is the monitor name.
export function MonitorCards({
  organizationId,
  monitors,
}: {
  organizationId: string;
  monitors: Row[];
}) {
  return (
    <HairlineGrid
      as="ul"
      className="grid-cols-1 lg:grid-cols-2 lg:[&>li:last-child:nth-child(odd)]:col-span-2"
    >
      {monitors.map((row) => {
        const initials = initialsOf(row.name);
        return (
          <li
            key={row.id}
            className="flex min-h-[148px] gap-4 p-5 hover:surface-hover"
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded border border-foreground/20 text-xs font-bold text-foreground-secondary",
                initialsFontClass(initials),
              )}
            >
              {initials}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Link
                  to={`/organizations/${organizationId}/monitors/${row.id}`}
                  className="text-[15px] font-semibold text-heading underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {row.name}
                </Link>
                <HealthPill health={row.health} />
              </div>
              <span className="break-all font-mono text-xs text-foreground-secondary">
                {row.url}
              </span>
              <StatusDetail row={row} />
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs text-foreground-secondary">
                <SslLabel
                  level={row.ssl.level}
                  daysRemaining={row.ssl.daysRemaining}
                  className="text-xs"
                />
                {row.lastCheckAt === null ? (
                  <span>{NO_DATA}</span>
                ) : (
                  <>
                    <span>
                      ตรวจล่าสุด{" "}
                      <Time iso={row.lastCheckAt} format={formatTimeOrDate} />
                    </span>
                    <span>({TIME_ZONE})</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
              <span className="sr-only">ตอบสนอง</span>
              <span
                className={cn(
                  "text-lg font-medium text-heading tabular-nums",
                  row.lastResponseTimeMs !== null && "font-mono",
                )}
              >
                {row.lastResponseTimeMs === null
                  ? NO_DATA
                  : `${formatNumber(row.lastResponseTimeMs)} ms`}
              </span>
              <span className="text-xs text-foreground-secondary">30 วัน</span>
              <span className="text-xs text-foreground-secondary">
                <Uptime window={row.uptime.d30} />
              </span>
            </div>
          </li>
        );
      })}
    </HairlineGrid>
  );
}
