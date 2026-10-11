import { TIME_ZONE, formatNumber } from "../../pages/monitors/format";
import {
  entryTime,
  RANGE_LABELS,
  type ChartRange,
  type SeriesEntry,
} from "./response-time-series";

const KIND_NOTES = {
  value: "",
  "no-response": "ตรวจแล้ว ไม่มีเวลาตอบสนอง",
  "check-error": "ตรวจไม่ได้ (ปัญหาฝั่งระบบ)",
  gap: "ไม่มีข้อมูล",
  pause: "หยุดชั่วคราว",
} as const;

function note(entry: SeriesEntry): string {
  const parts: string[] = [];
  if (KIND_NOTES[entry.kind] !== "") parts.push(KIND_NOTES[entry.kind]);
  if (entry.changes.some((change) => change.urlChanged)) {
    parts.push("เปลี่ยน URL");
  } else if (entry.changes.length > 0) {
    parts.push("แก้ไขการตั้งค่า");
  }
  return parts.join(", ");
}

/** The chart's data as a real table, read from the same series as the line (CMP-05). */
export function ResponseTimeTable({
  range,
  series,
}: {
  range: ChartRange;
  series: readonly SeriesEntry[];
}) {
  const hourly = range !== "24h";
  return (
    <div
      data-testid="monitor-response-table-region"
      data-range={range}
      role="region"
      aria-label="ข้อมูลกราฟเวลาตอบสนอง"
      tabIndex={0}
      className="max-h-80 overflow-auto rounded-md border border-foreground/10 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
    >
      <table
        data-testid="monitor-response-table"
        className="w-full min-w-[480px] text-left text-sm"
      >
        <caption
          data-testid="monitor-response-table-caption"
          className="p-3 text-left text-xs text-foreground-secondary"
        >
          เวลาตอบสนอง หน่วย ms ช่วง {RANGE_LABELS[range]} แหล่ง ผลการตรวจของ
          NightWatch
        </caption>
        <thead className="surface-inset sticky top-0 text-xs text-foreground-secondary">
          <tr>
            <th
              data-testid="monitor-response-heading-time"
              scope="col"
              className="h-10 px-3 font-medium"
            >
              เวลา ({TIME_ZONE})
            </th>
            <th
              data-testid="monitor-response-heading-average"
              scope="col"
              className="h-10 px-3 text-end font-medium"
            >
              {hourly ? "เฉลี่ย (ms)" : "เวลาตอบสนอง (ms)"}
            </th>
            {hourly ? (
              <th
                data-testid="monitor-response-heading-max"
                scope="col"
                className="h-10 px-3 text-end font-medium"
              >
                สูงสุด (ms)
              </th>
            ) : null}
            <th
              data-testid="monitor-response-heading-note"
              scope="col"
              className="h-10 px-3 font-medium"
            >
              หมายเหตุ
            </th>
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => (
            <tr
              data-testid="monitor-response-record"
              data-kind={entry.kind}
              data-at={entry.at}
              data-end={entry.end}
              data-checks={entry.checks}
              data-change-count={entry.changes.length}
              data-response-checks={entry.responseChecks ?? ""}
              key={entry.key}
              className="border-t border-foreground/10"
            >
              <th
                data-testid="monitor-response-cell-time"
                scope="row"
                className="px-3 py-2 font-normal"
              >
                {entryTime(range, entry)}
              </th>
              <td
                data-testid="monitor-response-cell-average"
                className="px-3 py-2 text-end tabular-nums"
              >
                {entry.avgMs === null ? "–" : formatNumber(entry.avgMs)}
              </td>
              {hourly ? (
                <td
                  data-testid="monitor-response-cell-max"
                  className="px-3 py-2 text-end tabular-nums"
                >
                  {entry.maxMs === null ? "–" : formatNumber(entry.maxMs)}
                </td>
              ) : null}
              <td
                data-testid="monitor-response-cell-note"
                className="px-3 py-2 text-foreground-secondary"
              >
                {note(entry)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
