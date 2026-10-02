import type { MonitorListResponse } from "@nightwatch/api-contract";
import { Link } from "react-router";

import { HairlineGrid } from "../../components/ui/hairline-grid";
import { STAT_TILE_CLASS, StatTile } from "../../components/ui/stat-tile";
import { cn } from "@/lib/utils";
import { HEALTH_LABELS } from "../monitors/HealthPill";
import { hasSslWarning, type MonitorRow } from "./rows";

const NAME_LIMIT = 2;

function downNote(monitors: MonitorRow[]): string {
  const names = monitors
    .filter((row) => row.health === "down")
    .map((row) => row.name);
  if (names.length === 0) return "ไม่มีมอนิเตอร์ที่ล่ม";
  const rest = names.length - NAME_LIMIT;
  return rest > 0
    ? `${names.slice(0, NAME_LIMIT).join(", ")} และอีก ${String(rest)}`
    : names.join(", ");
}

type Tile = {
  key: string;
  dot: string;
  value: number;
  label: string;
  note: string;
};

// Four tiles as on the canvas; `unknown` rides in the first note so the state stays visible.
export function StatStrip({
  organizationId,
  summary,
  monitors,
}: {
  organizationId: string;
  summary: MonitorListResponse["summary"];
  monitors: MonitorRow[];
}) {
  const ssl = monitors.filter(hasSslWarning).length;
  const expired = monitors.filter((row) => row.ssl.level === "expired").length;
  const tiles: Tile[] = [
    {
      key: "up",
      dot: "bg-primary",
      value: summary.up,
      label: HEALTH_LABELS.up,
      note:
        summary.unknown > 0
          ? `${HEALTH_LABELS.unknown} ${String(summary.unknown)}`
          : "ไม่มีมอนิเตอร์ที่ไม่ทราบสถานะ",
    },
    {
      key: "down",
      dot: "bg-danger",
      value: summary.down,
      label: HEALTH_LABELS.down,
      note: downNote(monitors),
    },
    {
      key: "ssl",
      dot: "bg-caution",
      value: ssl,
      label: "SSL ใกล้หมดอายุ",
      note:
        expired > 0
          ? `หมดอายุแล้ว ${String(expired)} · เตือนเมื่อเหลือ 30 วัน วิกฤตเมื่อเหลือ 7 วัน`
          : "เตือนเมื่อเหลือ 30 วัน วิกฤตเมื่อเหลือ 7 วัน",
    },
    {
      key: "paused",
      dot: "bg-foreground-secondary",
      value: summary.paused,
      label: HEALTH_LABELS.paused,
      note: summary.paused === 0 ? "ไม่มีมอนิเตอร์ที่หยุดชั่วคราว" : "",
    },
  ];
  return (
    <HairlineGrid
      as="section"
      aria-label="สรุปสถานะ"
      className="grid-cols-2 lg:grid-cols-4"
    >
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          to={`/organizations/${organizationId}/monitors`}
          className={cn(
            STAT_TILE_CLASS,
            "text-foreground hover:surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          )}
        >
          <StatTile
            dot={tile.dot}
            label={tile.label}
            value={tile.value}
            total={summary.total}
            note={tile.note}
          />
        </Link>
      ))}
    </HairlineGrid>
  );
}
