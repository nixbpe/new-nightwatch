import { useState } from "react";

import { CopyIcon } from "../shell/icons";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Notice } from "./notice";

// The status region stays mounted so a repeat copy is announced again.
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
  /** A text button with the icon; otherwise an icon-only button whose tooltip is `label`. */
  showLabel?: boolean;
  "data-testid"?: string;
}) {
  const [status, setStatus] = useState<"copied" | "failed" | null>(null);
  const copy = () => {
    setStatus(null);
    navigator.clipboard.writeText(value).then(
      () => {
        setStatus("copied");
      },
      () => {
        setStatus("failed");
      },
    );
  };
  return (
    <>
      {showLabel ? (
        <Button
          data-testid={testId}
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
        >
          <CopyIcon size={14} />
          {label}
        </Button>
      ) : (
        <IconButton
          data-testid={testId}
          label={label}
          icon={<CopyIcon size={16} />}
          onClick={copy}
        />
      )}
      <div
        data-testid={testId === undefined ? undefined : `${testId}-status`}
        data-status={status ?? "idle"}
        role="status"
        className="inline-flex"
      >
        {status === "copied" ? (
          <Notice tone="success" className="text-[13px]">
            {copiedLabel}
          </Notice>
        ) : status === "failed" ? (
          <span className="text-[13px] text-danger">
            คัดลอกไม่สำเร็จ เลือกข้อความแล้วคัดลอกเอง
          </span>
        ) : null}
      </div>
    </>
  );
}
