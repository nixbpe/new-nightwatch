import type { MonitorHealthName } from "@nightwatch/api-contract";

import { CheckIcon } from "../../components/shell/icons";
import { StatusPill } from "../../components/ui/status-pill";

export const HEALTH_LABELS: Record<MonitorHealthName, string> = {
  up: "ปกติ",
  down: "ล่ม",
  unknown: "ไม่ทราบสถานะ",
  paused: "หยุดชั่วคราว",
};

const HEALTH_TONES = {
  up: "primary",
  down: "danger",
  unknown: "neutral",
  paused: "muted",
} as const satisfies Record<
  MonitorHealthName,
  "primary" | "danger" | "neutral" | "muted"
>;

// Only `up` earns the primary tone and the check icon (CMP-01); every state is also written out.
export function HealthPill({ health }: { health: MonitorHealthName }) {
  return (
    <StatusPill tone={HEALTH_TONES[health]} dot={health !== "up"}>
      {health === "up" ? <CheckIcon size={12} /> : null}
      {HEALTH_LABELS[health]}
    </StatusPill>
  );
}
