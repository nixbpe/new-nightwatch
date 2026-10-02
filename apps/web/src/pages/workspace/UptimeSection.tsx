import { Link } from "react-router";

import { MockupFrame } from "../../components/ui/mockup-frame";
import { SectionHeader } from "../../components/ui/section-header";
import { cn } from "@/lib/utils";
import { formatNumber } from "../monitors/format";
import { NO_DATA } from "../monitors/MonitorTable";
import type { MonitorRow } from "./rows";

const ROW_LIMIT = 8;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const TH =
  "px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-foreground-secondary";
const TD = "border-t border-foreground/10 px-4 py-3.5 align-middle";

export function UptimeSection({
  organizationId,
  monitors,
  total,
}: {
  organizationId: string;
  monitors: MonitorRow[];
  total: number;
}) {
  const rows = monitors.slice(0, ROW_LIMIT);
  return (
    <section aria-labelledby="overview-uptime" className="flex flex-col">
      <SectionHeader
        id="overview-uptime"
        code="03"
        title="ความพร้อมใช้งาน 30 วัน"
        meta={
          <Link
            to={`/organizations/${organizationId}/monitors`}
            className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            ดูทั้ง <span className="font-mono">{total}</span> รายการ →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <caption className="sr-only">
            ความพร้อมใช้งาน 30 วันของมอนิเตอร์
          </caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                มอนิเตอร์
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                ความพร้อมใช้งาน 30 วัน
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                ตอบสนองล่าสุด
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { percent, coveragePercent } = row.uptime.d30;
              return (
                <tr key={row.id}>
                  <td className={TD}>
                    <Link
                      to={`/organizations/${organizationId}/monitors/${row.id}`}
                      className="font-medium text-heading underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {row.name}
                    </Link>
                    <span className="block font-mono text-xs text-foreground-secondary">
                      {hostOf(row.url)}
                    </span>
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    {percent === null ? (
                      NO_DATA
                    ) : (
                      <span className="font-mono">
                        {formatNumber(percent)}%
                      </span>
                    )}
                    {percent !== null && coveragePercent < 100 ? (
                      <span className="block text-xs text-foreground-secondary">
                        ครอบคลุม{" "}
                        <span className="font-mono">
                          {formatNumber(coveragePercent)}%
                        </span>
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "text-right text-foreground-secondary tabular-nums",
                    )}
                  >
                    {row.lastResponseTimeMs === null ? (
                      NO_DATA
                    ) : (
                      <span className="font-mono">
                        {formatNumber(row.lastResponseTimeMs)} ms
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <UptimeStripMockup />
    </section>
  );
}

type Cell = "ok" | "down" | "none";

// Neutral marks only (CMP-05): the legend and the row summary carry the meaning.
const CELL_CLASS: Record<Cell, string> = {
  ok: "bg-foreground/30",
  down: "bg-foreground",
  none: "border border-foreground/20",
};

function sampleDays(down: number[], none: number[]): Cell[] {
  return Array.from({ length: 30 }, (_, i) =>
    none.includes(i) ? "none" : down.includes(i) ? "down" : "ok",
  );
}

const SAMPLE_ROWS = [
  {
    name: "monitor-ตัวอย่าง-1",
    days: sampleDays([6, 29], []),
    summary: "30 วัน: ล่ม 2 วัน",
    avg: "000 ms",
  },
  {
    name: "monitor-ตัวอย่าง-2",
    days: sampleDays([29], [0, 1, 2]),
    summary: "30 วัน: ล่ม 1 วัน ไม่มีข้อมูล 3 วัน",
    avg: "000 ms",
  },
];

const LEGEND: { cell: Cell; label: string }[] = [
  { cell: "ok", label: "ตอบกลับปกติทั้งวัน" },
  { cell: "down", label: "มีช่วงล่ม" },
  { cell: "none", label: "ไม่มีข้อมูล" },
];

function UptimeStripMockup() {
  return (
    <MockupFrame
      label="แถบความพร้อมใช้งานรายวันและเวลาตอบสนองเฉลี่ย"
      issue={56}
      className="mt-4"
    >
      <ul className="flex flex-col gap-3">
        {SAMPLE_ROWS.map((row) => (
          <li
            key={row.name}
            className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[160px_minmax(0,1fr)_88px]"
          >
            <span className="truncate text-sm">{row.name}</span>
            <span
              role="img"
              aria-label={row.summary}
              className="grid h-[22px] grid-cols-[repeat(30,minmax(0,1fr))] gap-0.5"
            >
              {row.days.map((cell, index) => (
                <i
                  key={index}
                  className={cn("block rounded-[1px]", CELL_CLASS[cell])}
                />
              ))}
            </span>
            <span className="text-right text-xs text-foreground-secondary">
              เฉลี่ย <span className="font-mono">{row.avg}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground-secondary">
        {LEGEND.map((item) => (
          <span key={item.cell} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={cn(
                "inline-block size-2.5 rounded-[1px]",
                CELL_CLASS[item.cell],
              )}
            />
            {item.label}
          </span>
        ))}
      </p>
    </MockupFrame>
  );
}
