import type { Monitor } from "@nightwatch/api-contract";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { HairlineGrid } from "../../../components/ui/hairline-grid";
import { SectionHeader } from "../../../components/ui/section-header";
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatTimeOrDate,
  formatTimeWithSeconds,
  HEALTH_REASON_LABELS,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "../format";
import { useTenant } from "../../../lib/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import { UptimeStripMockup } from "./MonitorDetailMockups";

export const NO_DATA = "ยังไม่มีข้อมูล";

/** One line under the pill that says why the state holds; the pill itself is the state. */
export function statusLine(monitor: Monitor): ReactNode {
  const { health, healthReason, openIncident } = monitor;
  if (health === "down" && openIncident !== null) {
    const seconds = Math.max(
      0,
      Math.floor(
        (new Date(monitor.dataAsOf).getTime() -
          new Date(openIncident.startedAt).getTime()) /
          1000,
      ),
    );
    return (
      <>
        ตั้งแต่ <Time iso={openIncident.startedAt} format={formatTimeOrDate} />{" "}
        ({formatDuration(seconds)})
      </>
    );
  }
  if (health === "unknown") {
    if (healthReason === "stale" && monitor.lastCheckAt !== null) {
      return (
        <>
          {HEALTH_REASON_LABELS.stale}ตั้งแต่{" "}
          <Time iso={monitor.lastCheckAt} format={formatTimeOrDate} />
        </>
      );
    }
    return healthReason === null ? null : HEALTH_REASON_LABELS[healthReason];
  }
  return null;
}

function UptimeWindow({
  label,
  window,
}: {
  label: string;
  window: Monitor["uptime"]["h24"];
}) {
  return (
    <div className="p-4">
      <dt className="text-sm text-foreground-secondary">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-medium text-heading tabular-nums">
        {window.percent === null ? (
          <span className="font-sans text-base font-normal">{NO_DATA}</span>
        ) : (
          `${formatPercent(window.percent)}%`
        )}
      </dd>
      {window.percent === null ? null : (
        <dd className="mt-1 text-xs text-foreground-secondary">
          จากการตรวจ{" "}
          <span className="font-mono">{formatNumber(window.checks)}</span> ครั้ง
          ครอบคลุม{" "}
          <span className="font-mono">
            {formatPercent(window.coveragePercent)}%
          </span>
        </dd>
      )}
    </div>
  );
}

/** COL-06: Danger border and 10 % / 6 % fill, an icon and the written state. No live region: the duration changes every poll. */
export function DownBanner({
  monitor,
  organizationId,
}: {
  monitor: Monitor;
  organizationId: string;
}) {
  const { serverActiveOrgId } = useTenant();
  const { openIncident } = monitor;
  if (monitor.health !== "down" || openIncident === null) return null;
  return (
    <div className="flex flex-wrap items-start gap-3.5 rounded-md border border-danger bg-danger-tint px-4 py-4">
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-px shrink-0 text-danger"
      >
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <p className="font-semibold text-heading">
          <span>ล่ม</span> <span>{statusLine(monitor)}</span>
        </p>
        <p className="text-sm text-foreground-secondary">
          สาเหตุ {incidentReasonLabel(openIncident.reason)} (คาดหวัง{" "}
          <span className="font-mono">{monitor.expectedStatus}</span>)
        </p>
      </div>
      {/* /notifications shows the server-active organization's inbox; any other organization's banner must not link to it. */}
      {organizationId === serverActiveOrgId ? (
        <Link
          to="/notifications"
          className="inline-flex min-h-6 items-center text-xs whitespace-nowrap text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          ดูการแจ้งเตือน
        </Link>
      ) : null}
    </div>
  );
}

/** `fresh` is false while the last refresh failed: the dot drops its pulse and its colour (MOT-01, CMP-01). */
export function StatusCard({
  monitor,
  fresh,
}: {
  monitor: Monitor;
  fresh: boolean;
}) {
  const { health, healthReason, consecutiveFailures } = monitor;
  const failing =
    consecutiveFailures > 0 &&
    (health === "up" || (health === "unknown" && healthReason === null));
  return (
    <section aria-labelledby="detail-status" className="flex flex-col gap-4">
      <SectionHeader
        id="detail-status"
        title="สถานะปัจจุบัน"
        meta={
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "size-[6px] shrink-0 rounded-full",
                fresh ? "live-pulse bg-primary" : "bg-foreground-secondary",
              )}
            />
            <span>
              ข้อมูล ณ{" "}
              <span className="font-mono">
                <Time iso={monitor.dataAsOf} format={formatTimeWithSeconds} />
              </span>{" "}
              ({TIME_ZONE})
            </span>
          </span>
        }
      />
      {failing || monitor.lastKnownDown ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {monitor.lastKnownDown ? <span>ล่าสุดทราบว่าล่ม</span> : null}
          {failing ? (
            <span className="font-medium text-caution">
              ล้มเหลว {consecutiveFailures} ครั้ง
              <span className="font-normal text-foreground-secondary">
                {" "}
                จะเปลี่ยนเป็นล่มเมื่อล้มเหลวติดกันครบ{" "}
                {monitor.alerts.failureThreshold} ครั้ง
              </span>
            </span>
          ) : null}
        </p>
      ) : null}
      <HairlineGrid as="dl" className="grid-cols-1 sm:grid-cols-3">
        <UptimeWindow
          label="ความพร้อมใช้งาน 24 ชม."
          window={monitor.uptime.h24}
        />
        <UptimeWindow
          label="ความพร้อมใช้งาน 7 วัน"
          window={monitor.uptime.d7}
        />
        <UptimeWindow
          label="ความพร้อมใช้งาน 30 วัน"
          window={monitor.uptime.d30}
        />
      </HairlineGrid>
      <p className="text-xs text-foreground-secondary">
        คำนวณจากการตรวจที่มีผล ไม่รวมช่วงหยุดชั่วคราวและช่วงที่ตรวจไม่ได้
        ช่วงไม่มีข้อมูลไม่นับเป็นปกติ
      </p>
      <UptimeStripMockup />
    </section>
  );
}
