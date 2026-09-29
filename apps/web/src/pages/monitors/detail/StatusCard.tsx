import type { Monitor } from "@nightwatch/api-contract";
import type { ReactNode } from "react";

import { Card, CardHeader } from "../../../components/ui/card";
import {
  formatDuration,
  formatNumber,
  formatTimeOrDate,
  formatTimeWithSeconds,
  HEALTH_REASON_LABELS,
  incidentReasonLabel,
  Time,
  TIME_ZONE,
} from "../format";
import { DOWN_AFTER_FAILURES } from "./labels";

const NO_DATA = "ยังไม่มีข้อมูล";

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
    <div className="rounded-md border border-foreground/10 p-3">
      <dt className="text-sm text-foreground-secondary">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-heading tabular-nums">
        {window.percent === null ? (
          <span className="text-base font-normal">{NO_DATA}</span>
        ) : (
          `${formatNumber(window.percent)}%`
        )}
      </dd>
      {window.percent === null ? null : (
        <dd className="mt-1 text-xs text-foreground-secondary">
          จากการตรวจ {formatNumber(window.checks)} ครั้ง ครอบคลุม{" "}
          {formatNumber(window.coveragePercent)}%
        </dd>
      )}
    </div>
  );
}

export function StatusCard({ monitor }: { monitor: Monitor }) {
  const { health, healthReason, openIncident, consecutiveFailures } = monitor;
  const failing =
    consecutiveFailures > 0 &&
    (health === "up" || (health === "unknown" && healthReason === null));
  const cause =
    health === "down" && openIncident !== null
      ? incidentReasonLabel(openIncident.reason)
      : null;
  return (
    <Card as="section" aria-labelledby="detail-status">
      <CardHeader
        id="detail-status"
        title="สถานะปัจจุบัน"
        description={
          <>
            ข้อมูล ณ{" "}
            <Time iso={monitor.dataAsOf} format={formatTimeWithSeconds} /> (
            {TIME_ZONE})
          </>
        }
        className="border-b border-foreground/10 p-4"
      />
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {cause === null ? null : (
            <span>
              สาเหตุ {cause} (คาดหวัง {monitor.expectedStatus})
            </span>
          )}
          {monitor.lastKnownDown ? <span>ล่าสุดทราบว่าล่ม</span> : null}
          {monitor.lastCheckAt === null ? (
            <span>รอตรวจครั้งแรก</span>
          ) : (
            <span>
              ตรวจล่าสุด{" "}
              <Time iso={monitor.lastCheckAt} format={formatTimeOrDate} /> (
              {TIME_ZONE})
            </span>
          )}
        </p>
        {failing ? (
          <p className="font-medium text-caution">
            ล้มเหลว {consecutiveFailures} ครั้ง
            <span className="font-normal text-foreground-secondary">
              {" "}
              จะเปลี่ยนเป็นล่มเมื่อล้มเหลวติดกันครบ {DOWN_AFTER_FAILURES} ครั้ง
            </span>
          </p>
        ) : null}
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <UptimeWindow label="Uptime 24 ชม." window={monitor.uptime.h24} />
          <UptimeWindow label="Uptime 7 วัน" window={monitor.uptime.d7} />
          <UptimeWindow label="Uptime 30 วัน" window={monitor.uptime.d30} />
        </dl>
        <p className="text-xs text-foreground-secondary">
          คำนวณจากการตรวจที่มีผล ไม่รวมช่วงหยุดชั่วคราวและช่วงที่ตรวจไม่ได้
          ช่วงไม่มีข้อมูลไม่นับเป็นปกติ
        </p>
      </div>
    </Card>
  );
}
