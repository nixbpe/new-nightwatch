import { HairlineGrid } from "../../../components/ui/hairline-grid";
import { MockupFrame } from "../../../components/ui/mockup-frame";
import type { ChartRange } from "../../../components/ui/response-time-series";
import { RANGE_LABELS } from "../../../components/ui/response-time-series";

// Designed elements with no backing data yet (CMP-06). Everything here is sample
// data: neutral colours, no status tone, no live region, no claim of freshness (CMP-05).

const SAMPLE_DAYS = Array.from({ length: 90 }, (_, index) => {
  if (index < 4) return "none";
  return index === 40 ? "down" : "ok";
});

const DAY_CLASS = {
  ok: "bg-foreground/40",
  down: "bg-foreground",
  none: "bg-foreground/10",
} as const;

/** Issue #56: a 90-day availability strip needs a per-day uptime series. */
export function UptimeStripMockup() {
  return (
    <MockupFrame label="ความพร้อมใช้งาน 90 วัน" issue={56}>
      <p className="text-xs text-foreground-secondary">
        ความพร้อมใช้งาน{" "}
        <span className="font-mono font-medium text-foreground">00.00%</span>{" "}
        ล่ม <span className="font-mono">N</span> วัน
      </p>
      <div
        role="img"
        aria-label="ตัวอย่าง: 90 วัน มีช่วงล่มบางวัน ไม่มีข้อมูล 4 วันแรก"
        className="mt-3 grid h-7 grid-cols-[repeat(90,minmax(0,1fr))] gap-0.5"
      >
        {SAMPLE_DAYS.map((day, index) => (
          <i key={index} className={`block rounded-[1px] ${DAY_CLASS[day]}`} />
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-foreground-secondary">
        {(
          [
            ["ok", "ปกติทั้งวัน"],
            ["down", "มีช่วงล่ม"],
            ["none", "ไม่มีข้อมูล"],
          ] as const
        ).map(([day, text]) => (
          <span key={day} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={`block h-2.5 w-2.5 rounded-[1px] ${DAY_CLASS[day]}`}
            />
            {text}
          </span>
        ))}
      </p>
    </MockupFrame>
  );
}

/** Issue #57: percentiles and failed counts for 7d and 30d need server-side aggregation. */
export function PercentilesMockup({ range }: { range: ChartRange }) {
  const cells = [
    ["p50", "000 ms"],
    ["p95", "000 ms"],
    ["ล้มเหลว", "00"],
  ] as const;
  return (
    <MockupFrame
      label={`p50 p95 และจำนวนครั้งที่ล้มเหลว ${RANGE_LABELS[range]}`}
      issue={57}
    >
      <HairlineGrid as="dl" className="grid-cols-3">
        {cells.map(([label, value]) => (
          <div key={label} className="px-4 py-3">
            <dt className="text-xs text-foreground-secondary">{label}</dt>
            <dd className="mt-1 font-mono text-xl font-medium text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </HairlineGrid>
    </MockupFrame>
  );
}
