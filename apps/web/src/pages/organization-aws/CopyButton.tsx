import { useState } from "react";

import { Button } from "../../components/ui/button";

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  showLabel = false,
  "data-testid": testId,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  /** Icon-only buttons keep the label as their accessible name. */
  showLabel?: boolean;
  "data-testid"?: string;
}) {
  // Cleared on each click so a second copy is announced again.
  const [status, setStatus] = useState<"copied" | "failed" | null>(null);
  return (
    <>
      <Button
        data-testid={testId}
        type="button"
        variant="ghost"
        size={showLabel ? "sm" : "icon"}
        className={showLabel ? undefined : "h-8 w-8"}
        aria-label={showLabel ? undefined : label}
        onClick={() => {
          setStatus(null);
          navigator.clipboard.writeText(value).then(
            () => {
              setStatus("copied");
            },
            () => {
              setStatus("failed");
            },
          );
        }}
      >
        <CopyIcon />
        {showLabel ? label : null}
      </Button>
      <span
        data-testid={testId === undefined ? undefined : `${testId}-status`}
        role="status"
        className={
          status === "failed"
            ? "text-[13px] text-danger"
            : "text-[13px] text-foreground-secondary"
        }
      >
        {status === "copied"
          ? copiedLabel
          : status === "failed"
            ? "คัดลอกไม่สำเร็จ เลือกข้อความแล้วคัดลอกเอง"
            : ""}
      </span>
    </>
  );
}
