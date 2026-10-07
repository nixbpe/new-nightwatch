import { MONITOR_RESPONSE_POINTS_MAX } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { HairlineGrid } from "../../../components/ui/hairline-grid";
import { ResponseTimeTable } from "../../../components/ui/response-time-table";
import {
  buildSeries,
  chartWindow,
  hasChecks,
  HOURLY_CHECK_ERROR_NOTE,
  pausedThroughout,
  rangeStats,
  RANGE_LABELS,
  summarize,
  summaryText,
  toChartProps,
  type ChartRange,
} from "../../../components/ui/response-time-series";
import { SectionHeader } from "../../../components/ui/section-header";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { ApiError } from "../../../lib/api/client";
import {
  fetchMonitorResponseTimes,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import { isDenied } from "../../workspace/rows";
import { formatNumber, formatTimeOrDate, Time, TIME_ZONE } from "../format";

// d3 loads only when the Detail page shows a chart.
const ResponseTimeChart = lazy(() =>
  import("../../../components/ui/response-time-chart").then((module) => ({
    default: module.ResponseTimeChart,
  })),
);

const RANGE_OPTIONS = [
  { value: "24h", label: "24 ชม." },
  { value: "7d", label: "7 วัน" },
  { value: "30d", label: "30 วัน" },
] as const;

function ChartLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        กำลังโหลดกราฟเวลาตอบสนอง
      </p>
      <Skeleton className="h-60 w-full" />
    </div>
  );
}

function Kpi({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-foreground-secondary">{label}</dt>
      <dd
        className={`mt-1 ${value === "ไม่มีข้อมูล" ? "font-sans text-base" : "font-mono text-[22px] leading-8 font-medium tabular-nums"} ${danger ? "text-danger" : "text-heading"}`}
      >
        {value}
      </dd>
    </div>
  );
}

const msText = (value: number | null) =>
  value === null ? "ไม่มีข้อมูล" : `${formatNumber(value)} ms`;

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "MONITOR_NOT_FOUND";
}

// Caption segments read as one paragraph, the way the design canvas sets them.
const SEPARATOR = " · ";

const boundFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const formatBound = (iso: string) => boundFormat.format(new Date(iso));

// Independent query: a failure stays inside this card.
export function ResponseTimeCard({
  organizationId,
  monitorId,
  lastCheckAt,
  intervalSeconds,
  createdAt,
}: {
  organizationId: string;
  monitorId: string;
  lastCheckAt: string | null;
  intervalSeconds: number;
  createdAt: string;
}) {
  const [range, setRange] = useState<ChartRange>("24h");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [announcement, setAnnouncement] = useState<{
    organizationId: string;
    monitorId: string;
    range: ChartRange;
    text: string;
  } | null>(null);
  const selection = useRef<{
    range: ChartRange;
    organizationId: string;
    monitorId: string;
  } | null>(null);
  const query = useQuery({
    queryKey: monitorQueryKeys.responseTimes(organizationId, monitorId, range),
    queryFn: () => fetchMonitorResponseTimes(organizationId, monitorId, range),
    refetchInterval: (query) =>
      isDenied(query.state.error) || isNotFound(query.state.error)
        ? false
        : MONITOR_REFETCH_INTERVAL_MS,
  });
  const denied = isDenied(query.error);
  const notFound = isNotFound(query.error);
  const data = denied || notFound ? undefined : query.data;
  const chartProps = useMemo(
    () =>
      data === undefined
        ? undefined
        : toChartProps(data, { intervalSeconds, createdAt }),
    [data, intervalSeconds, createdAt],
  );
  const series = useMemo(
    () => (chartProps === undefined ? [] : buildSeries(chartProps)),
    [chartProps],
  );

  const stats = data === undefined ? undefined : rangeStats(data);
  useEffect(() => {
    const pending = selection.current;
    if (
      pending === null ||
      pending.range !== range ||
      pending.organizationId !== organizationId ||
      pending.monitorId !== monitorId ||
      data === undefined ||
      query.isFetching ||
      query.isError
    )
      return;
    selection.current = null;
    const current = rangeStats(data);
    setAnnouncement({
      organizationId,
      monitorId,
      range,
      text: `${RANGE_LABELS[range]} p50 ${msText(current.p50Ms)} p95 ${msText(current.p95Ms)} จำนวนการตรวจ ${formatNumber(current.checks)} ล้มเหลว ${formatNumber(current.failed)}`,
    });
  }, [range, organizationId, monitorId, data, query.isFetching, query.isError]);

  const paused = chartProps !== undefined && pausedThroughout(chartProps);
  // The chart and the table both draw this window, so both views carry its notes.
  const window = chartProps === undefined ? undefined : chartWindow(chartProps);
  const windowClamped =
    window !== undefined &&
    chartProps?.window !== undefined &&
    window.from > Date.parse(chartProps.window.from);
  let body;
  if (denied || notFound) {
    body = (
      <Alert tone="info">
        {denied ? "คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้" : "ไม่พบมอนิเตอร์นี้"}
      </Alert>
    );
  } else if (chartProps !== undefined && (hasChecks(series) || paused)) {
    body = (
      <>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            setView((current) => (current === "chart" ? "table" : "chart"));
          }}
        >
          {view === "chart" ? "ดูข้อมูลกราฟเป็นตาราง" : "ดูข้อมูลเป็นกราฟ"}
        </Button>
        {view === "chart" ? (
          <Suspense fallback={<ChartLoading />}>
            <ResponseTimeChart {...chartProps} />
          </Suspense>
        ) : (
          <ResponseTimeTable range={range} series={series} />
        )}
        {windowClamped ? (
          <p className="text-xs text-foreground-secondary">
            ช่วงเวลาเริ่มตั้งแต่สร้างมอนิเตอร์
          </p>
        ) : null}
        {range === "24h" ? null : (
          <p className="text-xs text-foreground-secondary">
            {HOURLY_CHECK_ERROR_NOTE}
          </p>
        )}
        <p className="text-sm">
          {paused && !hasChecks(series)
            ? "หยุดชั่วคราวตลอดช่วง ไม่มีการตรวจ"
            : summaryText(summarize(series))}
        </p>
      </>
    );
  } else if (chartProps !== undefined) {
    body = (
      <p className="text-sm text-foreground-secondary">
        {lastCheckAt === null ? (
          "ยังไม่มีผลการตรวจ"
        ) : (
          <>
            ไม่มีผลใน{" "}
            {RANGE_OPTIONS.find((option) => option.value === range)?.label}{" "}
            (ผลล่าสุด <Time iso={lastCheckAt} format={formatTimeOrDate} />)
          </>
        )}
      </p>
    );
  } else if (query.isError) {
    body = (
      <>
        <Alert tone="error">โหลดกราฟเวลาตอบสนองไม่สำเร็จ</Alert>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => void query.refetch()}
        >
          ลองอีกครั้ง
        </Button>
      </>
    );
  } else {
    body = <ChartLoading />;
  }

  return (
    <section
      aria-labelledby="detail-response-times"
      className="flex flex-col gap-4"
    >
      <SectionHeader
        id="detail-response-times"
        title="เวลาตอบสนอง"
        meta={
          <SegmentedControl
            label="ช่วงเวลาของกราฟ"
            value={range}
            options={RANGE_OPTIONS}
            onChange={(next) => {
              selection.current = { range: next, organizationId, monitorId };
              setAnnouncement(null);
              setRange(next);
            }}
          />
        }
      />
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="response-range-announcement"
      >
        {data !== undefined &&
        announcement?.organizationId === organizationId &&
        announcement.monitorId === monitorId &&
        announcement.range === range
          ? announcement.text
          : ""}
      </p>
      <p className="text-xs text-foreground-secondary">
        <span>หน่วย: ms</span>
        {SEPARATOR}
        <span>ช่วง: {RANGE_LABELS[range]}</span>
        {SEPARATOR}
        <span>แหล่ง: ผลการตรวจของ NightWatch</span>
        {SEPARATOR}
        <span>
          p50/p95 จากเวลาที่วัดได้และไม่เป็น null
          รวมผลล้มเหลวและปัญหาฝั่งระบบที่วัดได้ ไม่มีค่าที่วัดได้แสดง
          “ไม่มีข้อมูล” จำนวนการตรวจนับ pass + fail ไม่นับปัญหาฝั่งระบบ
          ล้มเหลวนับผล fail ไม่ใช่จำนวนเหตุการณ์
        </span>
        {data === undefined ? null : (
          <>
            {SEPARATOR}
            <span>
              ช่วงข้อมูล: <Time iso={data.window.from} format={formatBound} />{" "}
              ถึง <Time iso={data.window.to} format={formatBound} /> (
              {TIME_ZONE})
              {range === "24h"
                ? null
                : " ขอบเริ่มปัดขึ้นเป็นชั่วโมง UTC รวมชั่วโมงปัจจุบันเฉพาะผลที่บันทึกแล้ว"}
            </span>
          </>
        )}
        {data?.range === "24h" &&
        data.points.length === MONITOR_RESPONSE_POINTS_MAX ? (
          <>
            {SEPARATOR}
            <span>คำนวณจากผลตรวจล่าสุดไม่เกิน 1,440 รายการ</span>
          </>
        ) : null}
      </p>
      {stats === undefined ? (
        denied || notFound || query.isError ? null : (
          <div
            aria-label="กำลังโหลดสรุปเวลาตอบสนอง"
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          >
            {["p50", "p95", "จำนวนการตรวจ", "ล้มเหลว"].map((label) => (
              <Skeleton key={label} className="h-20" />
            ))}
          </div>
        )
      ) : (
        <HairlineGrid as="dl" className="grid-cols-2 lg:grid-cols-4">
          <Kpi label="p50" value={msText(stats.p50Ms)} />
          <Kpi label="p95" value={msText(stats.p95Ms)} />
          <Kpi label="จำนวนการตรวจ" value={formatNumber(stats.checks)} />
          <Kpi
            label="ล้มเหลว"
            value={formatNumber(stats.failed)}
            danger={stats.failed > 0}
          />
        </HairlineGrid>
      )}
      <div className="flex flex-col gap-3">
        {body}
        {data !== undefined && query.isError ? (
          <>
            <Alert tone="warning">
              อัปเดตกราฟไม่สำเร็จ ข้อมูล ณ{" "}
              <Time iso={data.dataAsOf} format={formatBound} /> ({TIME_ZONE})
            </Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void query.refetch()}
            >
              ลองอีกครั้ง
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
