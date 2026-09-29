import type { SslLevelName } from "@nightwatch/api-contract";

import { cn } from "@/lib/utils";

type SslTone = "neutral" | "muted" | "caution" | "danger";

const TONE_CLASSES: Record<SslTone, string> = {
  neutral: "text-foreground",
  muted: "text-foreground-secondary",
  caution: "font-medium text-caution",
  danger: "font-medium text-danger",
};

const SSL_TONES: Record<SslLevelName, SslTone> = {
  ok: "neutral",
  caution: "caution",
  danger: "danger",
  expired: "danger",
  not_https: "muted",
  unreadable: "neutral",
  no_data: "neutral",
};

/** Days as the certificate view words them: 21 days left, expires in 5 days, expired 2 days ago. */
export function sslDaysText(
  level: SslLevelName,
  daysRemaining: number | null,
): string | null {
  if (level === "expired") {
    return daysRemaining !== null && daysRemaining < 0
      ? `เมื่อ ${String(-daysRemaining)} วันก่อน`
      : null;
  }
  if (daysRemaining === null) return null;
  return level === "danger"
    ? `หมดอายุใน ${String(daysRemaining)} วัน`
    : `เหลือ ${String(daysRemaining)} วัน`;
}

export function sslText(
  level: SslLevelName,
  daysRemaining: number | null,
): string {
  const days = sslDaysText(level, daysRemaining);
  switch (level) {
    case "ok":
      return days ?? "ปกติ";
    case "caution":
      return days === null ? "ใกล้หมดอายุ" : `ใกล้หมดอายุ ${days}`;
    case "danger":
      return days ?? "วิกฤต ใกล้หมดอายุ";
    case "expired":
      return days === null ? "หมดอายุแล้ว" : `หมดอายุแล้ว ${days}`;
    case "not_https":
      return "ไม่ใช้ HTTPS";
    case "unreadable":
      return "อ่านใบรับรองไม่ได้";
    case "no_data":
      return "ยังไม่มีข้อมูล";
  }
}

// Tone follows the level; the state is always in words (COL-01).
export function SslLabel({
  level,
  daysRemaining,
  className,
}: {
  level: SslLevelName;
  daysRemaining: number | null;
  className?: string;
}) {
  return (
    <span
      data-ssl-level={level}
      className={cn("text-sm", TONE_CLASSES[SSL_TONES[level]], className)}
    >
      {sslText(level, daysRemaining)}
    </span>
  );
}
