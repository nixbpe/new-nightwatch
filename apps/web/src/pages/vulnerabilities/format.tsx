import type { PriorityItem } from "@nightwatch/api-contract";

import { StatusPill } from "../../components/ui/status-pill";

export const SOURCE_LABELS = { nvd: "NVD", osv: "OSV" } as const;
export const FEED_LABELS = {
  nvd: "NVD",
  osv: "OSV",
  kev: "CISA KEV",
  epss: "EPSS",
} as const;
export const SEVERITY_LABELS = {
  critical: "วิกฤต",
  high: "สูง",
  medium: "กลาง",
  low: "ต่ำ",
  none: "ไม่มี",
} as const;
export const EXPOSURE_LABELS = {
  "Internet-facing": "เปิดสู่อินเทอร์เน็ต",
  Internal: "ภายใน",
  Isolated: "แยกเครือข่าย",
} as const;
export const PROVISIONAL_LABELS = {
  kev: "KEV",
  epss: "EPSS",
  cvss: "CVSS",
} as const;

/** A row that fills its container draws the focus ring inside it, where an outer ring would be clipped. */
export const FOCUS_RING_INSET = "focus-visible:-outline-offset-2";
/** A text link on its own line or cell: 24 px high (LAY-03). */
export const STANDALONE_LINK =
  "inline-flex min-h-6 items-center text-primary underline-offset-4 hover:underline";

export const percent = (rate: number) =>
  `${String(Math.round(rate * 1000) / 10)}%`;

type Severity = keyof typeof SEVERITY_LABELS;

/** The severity as a pill with its score when there is one; "ไม่ทราบ" when the feeds gave none. */
export function SeverityPill({
  score,
  level,
}: {
  score: number | null;
  level: Severity | null;
}) {
  if (score === null && level === null) {
    return <span className="text-foreground-secondary">ไม่ทราบ</span>;
  }
  return (
    <StatusPill
      dot
      neutralLabel
      tone={
        level === "critical" || level === "high"
          ? "danger"
          : level === "medium"
            ? "caution"
            : "muted"
      }
    >
      {score === null ? null : (
        <span className="font-mono">{score.toFixed(1)}</span>
      )}
      {level === null
        ? ""
        : `${score === null ? "" : " "}${SEVERITY_LABELS[level]}`}
    </StatusPill>
  );
}

/** The facts that placed an item, in the order the rule applies them, each as its own badge text. */
export function reasonBadges(item: PriorityItem): string[] {
  return item.reasons.map((reason) => {
    switch (reason) {
      case "kev":
        return "อยู่ใน KEV";
      case "exposure":
        return EXPOSURE_LABELS[item.exposure];
      case "epss":
        return `EPSS ${percent(item.epss ?? 0)}`;
      case "cvss":
        return `CVSS ${(item.cvssScore ?? 0).toFixed(1)}`;
    }
  });
}
