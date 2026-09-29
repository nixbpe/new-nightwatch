import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { TIME_ZONE, formatNumber } from "../../pages/monitors/format";
import {
  buildSeries,
  HOURLY_CHECK_ERROR_NOTE,
  describeEntry,
  RANGE_LABELS,
  type ResponseTimeChartProps,
  type SeriesEntry,
} from "./response-time-series";

const HEIGHT = 240;
const MARGIN = { top: 20, right: 16, bottom: 36, left: 56 };
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 280;
const HALF_HOUR_MS = 1_800_000;

const dayFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  day: "numeric",
  month: "short",
});
const clockFormat = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function useWidth<Element extends HTMLElement>() {
  const ref = useRef<Element>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measured = element.clientWidth;
    if (measured > 0) setWidth(Math.max(MIN_WIDTH, measured));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next > 0) {
        setWidth(Math.max(MIN_WIDTH, Math.floor(next)));
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, width };
}

function midpoint(entry: SeriesEntry): number {
  return (entry.at + entry.end) / 2;
}

/**
 * Response-time line drawn by hand from d3 scales (visx does not support
 * React 19). Colours are the status-role CSS tokens through Tailwind classes,
 * so both themes follow without a redraw. A step with no value ends the line
 * (`defined`), so a gap is never bridged; gaps and pauses are bands with
 * different fills so colour is never the only cue.
 */
export function ResponseTimeChart(props: ResponseTimeChartProps) {
  const { range } = props;
  const series = useMemo(
    () => buildSeries(props),
    // The props object is new on every render; its parts change only on a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.range, props.buckets, props.pauses, props.configChanges],
  );
  const { ref, width } = useWidth<HTMLDivElement>();
  const patternId = `gap-${useId().replace(/:/g, "")}`;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Written only by key presses, so a 30 s refetch never re-announces the selection.
  const [live, setLive] = useState({ text: "", count: 0 });

  const selectedIndex = series.findIndex((entry) => entry.key === selectedKey);
  const selected = selectedIndex === -1 ? undefined : series[selectedIndex];

  const first = series[0];
  const last = series[series.length - 1];
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const bottom = HEIGHT - MARGIN.bottom;
  let from = props.window ? Date.parse(props.window.from) : (first?.at ?? 0);
  let to = props.window ? Date.parse(props.window.to) : (last?.end ?? 1);
  for (const pause of props.pauses) {
    from = Math.min(from, Date.parse(pause.from));
    to = Math.max(to, Date.parse(pause.to));
  }
  if (to <= from) {
    from -= HALF_HOUR_MS;
    to += HALF_HOUR_MS;
  }
  const x = scaleTime()
    .domain([new Date(from), new Date(to)])
    .range([left, right]);
  // With no value to scale to, the axis reads 0 to 100 rather than 0 to 1 in fractions.
  const measured = series.map((entry) => entry.maxMs ?? entry.avgMs ?? 0);
  const top = Math.max(0, ...measured) > 0 ? Math.max(...measured) : 100;
  const y = scaleLinear().domain([0, top]).nice().range([bottom, MARGIN.top]);

  const path = line<SeriesEntry>()
    .defined((entry) => entry.kind === "value" && entry.avgMs !== null)
    .x((entry) => x(new Date(midpoint(entry))))
    .y((entry) => y(entry.avgMs ?? 0))(series);
  const isolated = series.filter((entry, index) => {
    const hasValue = (other: SeriesEntry | undefined) =>
      other?.kind === "value";
    return (
      entry.kind === "value" &&
      !hasValue(series[index - 1]) &&
      !hasValue(series[index + 1])
    );
  });

  const announce = (entry: SeriesEntry | undefined) => {
    if (entry === undefined) return;
    setSelectedKey(entry.key);
    setLive((previous) => ({
      text: describeEntry(range, entry),
      count: previous.count + 1,
    }));
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (series.length === 0) return;
    const lastIndex = series.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next =
          selectedIndex === -1 ? 0 : Math.min(selectedIndex + 1, lastIndex);
        break;
      case "ArrowLeft":
        next =
          selectedIndex === -1 ? lastIndex : Math.max(selectedIndex - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = lastIndex;
        break;
      default:
        return;
    }
    event.preventDefault();
    announce(series[next]);
  }

  // Pointer only moves the highlight; it never writes the live region.
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || series.length === 0) return;
    const at = x.invert(((event.clientX - box.left) / box.width) * width);
    let nearest = series[0];
    for (const entry of series) {
      if (
        nearest === undefined ||
        Math.abs(midpoint(entry) - at.getTime()) <
          Math.abs(midpoint(nearest) - at.getTime())
      ) {
        nearest = entry;
      }
    }
    if (nearest !== undefined) setSelectedKey(nearest.key);
  }

  const xTicks = x.ticks(width < 480 ? 4 : 6);
  const yTicks = y.ticks(4);
  const label = `กราฟเส้นเวลาตอบสนอง หน่วย ms ช่วง ${RANGE_LABELS[range]} แหล่ง ผลการตรวจของ NightWatch เวลาตามเขตเวลา ${TIME_ZONE} ใช้ลูกศรซ้ายขวา Home และ End เพื่อดูค่าแต่ละจุด`;

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
          onPointerMove={onPointerMove}
          className="block max-w-full text-foreground-secondary"
        >
          <defs>
            <pattern
              id={patternId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                strokeWidth="2"
                className="stroke-foreground-secondary/50"
              />
            </pattern>
          </defs>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-foreground/10"
              />
              <text
                x={left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-foreground-secondary text-[11px]"
              >
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          <text
            x={left - 8}
            y={10}
            textAnchor="end"
            className="fill-foreground-secondary text-[11px]"
          >
            ms
          </text>
          {xTicks.map((tick) => (
            <text
              key={tick.getTime()}
              x={x(tick)}
              y={bottom + 16}
              textAnchor="middle"
              className="fill-foreground-secondary text-[11px]"
            >
              {range === "24h"
                ? clockFormat.format(tick)
                : dayFormat.format(tick)}
            </text>
          ))}
          <text
            x={right}
            y={HEIGHT - 4}
            textAnchor="end"
            className="fill-foreground-secondary text-[11px]"
          >
            เวลา ({TIME_ZONE})
          </text>
          {props.pauses.map((pause) => {
            const start = x(new Date(pause.from));
            const w = Math.max(2, x(new Date(pause.to)) - start);
            return (
              <g key={`pause-${pause.from}`}>
                <rect
                  data-chart-part="pause"
                  x={start}
                  y={MARGIN.top}
                  width={w}
                  height={bottom - MARGIN.top}
                  className="fill-foreground/10"
                />
                {w > 84 ? (
                  <text
                    x={start + 6}
                    y={MARGIN.top + 14}
                    className="fill-foreground-secondary text-[11px]"
                  >
                    หยุดชั่วคราว
                  </text>
                ) : null}
              </g>
            );
          })}
          {series
            .filter((entry) => entry.kind === "gap")
            .map((entry) => {
              const start = x(new Date(entry.at));
              const w = Math.max(2, x(new Date(entry.end)) - start);
              return (
                <g key={entry.key}>
                  <rect
                    data-chart-part="gap"
                    x={start}
                    y={MARGIN.top}
                    width={w}
                    height={bottom - MARGIN.top}
                    fill={`url(#${patternId})`}
                  />
                  {w > 84 ? (
                    <text
                      x={start + 6}
                      y={MARGIN.top + 14}
                      className="fill-foreground-secondary text-[11px]"
                    >
                      ไม่มีข้อมูล
                    </text>
                  ) : null}
                </g>
              );
            })}
          {props.configChanges.map((change) => {
            const at = x(new Date(change.at));
            return (
              <g key={change.at} data-chart-part="config-change">
                <title>
                  {change.urlChanged ? "เปลี่ยน URL" : "แก้ไขการตั้งค่า"}
                </title>
                <line
                  x1={at}
                  x2={at}
                  y1={MARGIN.top}
                  y2={bottom}
                  strokeDasharray={change.urlChanged ? "2 3" : "6 3"}
                  strokeWidth="1.5"
                  className="stroke-caution"
                />
                <text
                  x={at + 4}
                  y={bottom - 6}
                  className="fill-caution text-[11px]"
                >
                  {change.urlChanged ? "URL" : "แก้ค่า"}
                </text>
              </g>
            );
          })}
          <line
            x1={left}
            x2={right}
            y1={bottom}
            y2={bottom}
            className="stroke-foreground/30"
          />
          {path === null ? null : (
            <path
              data-chart-part="line"
              d={path}
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              className="stroke-primary"
            />
          )}
          {isolated.map((entry) => (
            <circle
              key={entry.key}
              cx={x(new Date(midpoint(entry)))}
              cy={y(entry.avgMs ?? 0)}
              r="2.5"
              className="fill-primary"
            />
          ))}
          {series
            .filter(
              (entry) =>
                entry.kind === "no-response" || entry.kind === "check-error",
            )
            .map((entry) => {
              const cx = x(new Date(midpoint(entry)));
              const cy = bottom - 8;
              return entry.kind === "no-response" ? (
                <path
                  key={entry.key}
                  data-chart-part="no-response"
                  d={`M${String(cx - 4)},${String(cy - 4)}L${String(cx + 4)},${String(cy + 4)}M${String(cx - 4)},${String(cy + 4)}L${String(cx + 4)},${String(cy - 4)}`}
                  strokeWidth="2"
                  className="stroke-danger"
                />
              ) : (
                <circle
                  key={entry.key}
                  data-chart-part="check-error"
                  cx={cx}
                  cy={cy}
                  r="4"
                  strokeWidth="2"
                  className="fill-surface stroke-foreground-secondary"
                />
              );
            })}
          {selected === undefined ? null : selected.kind === "value" ? (
            <g data-chart-part="selection">
              <line
                x1={x(new Date(midpoint(selected)))}
                x2={x(new Date(midpoint(selected)))}
                y1={MARGIN.top}
                y2={bottom}
                strokeDasharray="3 3"
                className="stroke-foreground-secondary"
              />
              <circle
                cx={x(new Date(midpoint(selected)))}
                cy={y(selected.avgMs ?? 0)}
                r="5"
                strokeWidth="2"
                className="fill-surface stroke-primary"
              />
            </g>
          ) : (
            <rect
              data-chart-part="selection"
              x={x(new Date(selected.at))}
              y={MARGIN.top}
              width={Math.max(
                3,
                x(new Date(selected.end)) - x(new Date(selected.at)),
              )}
              height={bottom - MARGIN.top}
              fill="none"
              strokeWidth="2"
              className="stroke-primary"
            />
          )}
        </svg>
      </div>
      <p aria-hidden="true" className="min-h-5 text-sm text-foreground">
        {selected === undefined
          ? "เลือกกราฟด้วย Tab แล้วใช้ลูกศรซ้ายขวาเพื่อดูค่าแต่ละจุด"
          : `${describeEntry(range, selected)}${
              selected.changes.length === 0
                ? ""
                : ` (${selected.changes.some((c) => c.urlChanged) ? "เปลี่ยน URL" : "แก้ไขการตั้งค่า"})`
            }`}
      </p>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={live.count}>{live.text}</span>
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary">
        <span>เส้น: เวลาตอบสนอง</span>
        <span>แถบเทา: หยุดชั่วคราว</span>
        <span>แถบลาย: ไม่มีข้อมูล</span>
        <span>เส้นประ: เปลี่ยน URL หรือแก้ค่า</span>
        {series.some((entry) => entry.kind === "no-response") ? (
          <span>× ตรวจแล้ว ไม่มีเวลาตอบสนอง (เช่น หมดเวลา)</span>
        ) : null}
        {series.some((entry) => entry.kind === "check-error") ? (
          <span>○ ตรวจไม่ได้ (ปัญหาฝั่งระบบ)</span>
        ) : null}
      </p>
      {range === "24h" ? null : (
        <p className="text-xs text-foreground-secondary">
          {HOURLY_CHECK_ERROR_NOTE}
        </p>
      )}
    </div>
  );
}
