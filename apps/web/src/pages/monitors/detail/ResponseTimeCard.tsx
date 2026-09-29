import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Card, CardHeader } from "../../../components/ui/card";
import { ResponseTimeTable } from "../../../components/ui/response-time-table";
import {
  buildSeries,
  hasChecks,
  pausedThroughout,
  RANGE_LABELS,
  summarize,
  summaryText,
  toChartProps,
  type ChartRange,
} from "../../../components/ui/response-time-series";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import {
  fetchMonitorResponseTimes,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import { formatTimeOrDate, Time, TIME_ZONE } from "../format";

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

// Independent query: a failure stays inside this card.
export function ResponseTimeCard({
  organizationId,
  monitorId,
  lastCheckAt,
  dataAsOf,
  intervalSeconds,
}: {
  organizationId: string;
  monitorId: string;
  lastCheckAt: string | null;
  dataAsOf: string;
  intervalSeconds: number;
}) {
  const [range, setRange] = useState<ChartRange>("24h");
  const [tableOpen, setTableOpen] = useState(false);
  const query = useQuery({
    queryKey: monitorQueryKeys.responseTimes(organizationId, monitorId, range),
    queryFn: () => fetchMonitorResponseTimes(organizationId, monitorId, range),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
  });
  const chartProps = useMemo(
    () =>
      query.data === undefined
        ? undefined
        : toChartProps(query.data, { dataAsOf, intervalSeconds }),
    [query.data, dataAsOf, intervalSeconds],
  );
  const series = useMemo(
    () => (chartProps === undefined ? [] : buildSeries(chartProps)),
    [chartProps],
  );

  const paused = chartProps !== undefined && pausedThroughout(chartProps);
  let body;
  if (chartProps !== undefined && (hasChecks(series) || paused)) {
    body = (
      <>
        <Suspense fallback={<ChartLoading />}>
          <ResponseTimeChart {...chartProps} />
        </Suspense>
        <p className="text-sm">
          {paused && !hasChecks(series)
            ? "หยุดชั่วคราวตลอดช่วง ไม่มีการตรวจ"
            : summaryText(summarize(series))}
        </p>
        <div className="flex flex-col items-start gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={tableOpen}
            aria-controls="response-time-table"
            onClick={() => {
              setTableOpen((open) => !open);
            }}
          >
            ดูข้อมูลกราฟเป็นตาราง
          </Button>
          <div id="response-time-table" className="w-full">
            {tableOpen ? (
              <ResponseTimeTable range={range} series={series} />
            ) : null}
          </div>
        </div>
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
    <Card as="section" aria-labelledby="detail-response-times">
      <CardHeader
        id="detail-response-times"
        title="เวลาตอบสนอง"
        description={`หน่วย: ms ช่วง: ${RANGE_LABELS[range]} แหล่ง: ผลการตรวจของ NightWatch เวลาแสดงตามเขตเวลา ${TIME_ZONE}`}
        action={
          <SegmentedControl
            label="ช่วงเวลาของกราฟ"
            value={range}
            options={RANGE_OPTIONS}
            onChange={(next) => {
              setRange(next);
            }}
          />
        }
        className="border-b border-foreground/10 p-4"
      />
      <div className="flex flex-col gap-3 p-4">
        {body}
        {chartProps !== undefined && query.isError ? (
          <Alert tone="warning">อัปเดตกราฟไม่สำเร็จ</Alert>
        ) : null}
      </div>
    </Card>
  );
}
