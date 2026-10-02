import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const MOCKUP_NOTICE = "ตัวอย่าง · ยังไม่เชื่อมข้อมูลจริง";

const ISSUES_URL = "https://github.com/nixbpe/new-nightwatch/issues";

/** The CMP-06 notice line: what the region is, and the issue that will back it. */
export function MockupNotice({
  issue,
  issueUrl,
  className,
}: {
  issue: number;
  /** Defaults to this repository's issue `issue`. */
  issueUrl?: string;
  className?: string;
}) {
  return (
    <p
      data-slot="mockup-notice"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-secondary",
        className,
      )}
    >
      <span>{MOCKUP_NOTICE}</span>
      <a
        href={issueUrl ?? `${ISSUES_URL}/${String(issue)}`}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        ดู issue <span className="font-mono">#{issue}</span>
        <span className="sr-only"> (เปิดในแท็บใหม่)</span>
      </a>
    </p>
  );
}

/**
 * Sample content for a designed element with no backing data yet (CMP-06).
 * The dashed edge and the notice mark it; the group's name says it is an
 * example. Children must stay neutral (no status colours, live indicator or
 * freshness claim, CMP-05) and carry no live region.
 */
export function MockupFrame({
  label,
  issue,
  issueUrl,
  className,
  children,
}: {
  /** What the sample shows, e.g. "ความพร้อมใช้งาน 30 วัน". */
  label: string;
  issue: number;
  issueUrl?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={`ตัวอย่าง: ${label}`}
      data-slot="mockup-frame"
      className={cn(
        "flex flex-col gap-3 rounded-md border border-dashed border-foreground/20 p-4",
        className,
      )}
    >
      <MockupNotice issue={issue} issueUrl={issueUrl} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
