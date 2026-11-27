import { AUDIT_EXPORT_MAX_EVENTS } from "@nightwatch/api-contract";
import { useId, useRef, useState, type RefObject } from "react";

import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  EMPTY_REASON,
  REQUEST_FAILED_IN_DIALOG,
  tooLargeText,
  type ExportOutcome,
} from "./exports";
import { RecordingScopeNote } from "./RecordingScopeNote";

export type ExportDialogScope = {
  /** "HH:MM:SS" of the list the dialog was opened from. */
  loadedAt: string;
  timeZone: string;
  rangeText: string;
  filtersText: string;
  total: number;
  recordingSince: string | undefined;
};

// Not ConfirmDialog (M-3): focus starts on the first format, nothing uses `disabled`, and
// the content scrolls inside while the title and the buttons stay in view.
export function ExportDialog({
  scope,
  opener,
  fallbackFocus,
  onSubmit,
  onCancel,
  categoryCode,
}: {
  categoryCode?: string;
  scope: ExportDialogScope;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  /** Resolves with what the server said; the caller closes the dialog on `created`, `in-progress` and `denied`. */
  onSubmit: (format: "csv" | "json") => Promise<ExportOutcome>;
  onCancel: () => void;
}) {
  const messageId = useId();
  const firstFormat = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [total, setTotal] = useState(scope.total);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const tooLarge = total > AUDIT_EXPORT_MAX_EVENTS;

  const cancel = () => {
    if (!inFlight.current) onCancel();
  };

  const submit = async () => {
    if (inFlight.current || tooLarge) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage(null);
    const outcome = await onSubmit(format);
    inFlight.current = false;
    setSubmitting(false);
    if (outcome.kind === "too-large") setTotal(outcome.total);
    else if (outcome.kind === "empty") setMessage(EMPTY_REASON);
    else if (outcome.kind === "failed") setMessage(REQUEST_FAILED_IN_DIALOG);
  };

  const reasonId = tooLarge ? messageId : undefined;
  return (
    <Dialog
      data-testid="audit-export-dialog"
      title="ส่งออกบันทึกกิจกรรม"
      titleTestId="audit-export-dialog-title"
      busy={submitting}
      opener={opener}
      fallbackFocus={fallbackFocus}
      initialFocus={firstFormat}
      onClose={cancel}
    >
      <div
        data-testid="audit-export-dialog-body"
        tabIndex={0}
        role="region"
        aria-label="รายละเอียดการส่งออก"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-6"
      >
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
          <dt className="text-foreground-secondary">ขอบเขต</dt>
          <dd data-testid="audit-export-dialog-range" className="break-words">
            <span className="font-mono">{scope.rangeText}</span> (
            {scope.timeZone})
          </dd>
          <dt className="text-foreground-secondary">ตัวกรอง</dt>
          <dd
            data-testid="audit-export-dialog-filters"
            data-categories={categoryCode}
            className="break-words"
          >
            {scope.filtersText}
          </dd>
          <dt className="text-foreground-secondary">จำนวน</dt>
          <dd>
            <span data-testid="audit-export-dialog-total" className="font-mono">
              {total.toLocaleString("en-US")}
            </span>{" "}
            รายการ
          </dd>
        </dl>
        <p
          data-testid="audit-export-dialog-snapshot"
          data-time-zone={scope.timeZone}
          className="text-foreground-secondary"
        >
          ณ โหลดเมื่อ <span className="font-mono">{scope.loadedAt}</span> (
          {scope.timeZone})
        </p>
        <fieldset
          data-testid="audit-export-dialog-formats"
          className="flex flex-col gap-2"
        >
          <legend className="mb-1 font-medium">รูปแบบไฟล์</legend>
          {(["csv", "json"] as const).map((value) => (
            <label key={value} className="flex min-h-6 items-center gap-2">
              <input
                data-testid={`audit-export-dialog-format-${value}`}
                ref={value === "csv" ? firstFormat : undefined}
                type="radio"
                className="size-[18px] shrink-0 accent-primary"
                name="export-format"
                value={value}
                checked={format === value}
                onChange={() => {
                  if (!inFlight.current) setFormat(value);
                }}
              />
              {value === "csv" ? "CSV" : "JSON"}
            </label>
          ))}
        </fieldset>
        <RecordingScopeNote since={scope.recordingSince} />
        {tooLarge ? (
          <p
            data-testid="audit-export-dialog-too-large"
            id={messageId}
            role="alert"
            className="text-danger"
          >
            {tooLargeText(total)}
          </p>
        ) : null}
        {message === null ? null : (
          <p
            data-testid="audit-export-dialog-error"
            data-outcome={message === EMPTY_REASON ? "empty" : "failed"}
            role="alert"
            className="text-danger"
          >
            {message}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-foreground/10 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button
          data-testid="audit-export-dialog-cancel"
          type="button"
          variant="secondary"
          wrap
          aria-disabled={submitting ? true : undefined}
          onClick={cancel}
        >
          ยกเลิก
        </Button>
        <Button
          data-testid="audit-export-dialog-create"
          type="button"
          wrap
          aria-disabled={submitting || tooLarge ? true : undefined}
          aria-busy={submitting ? true : undefined}
          aria-describedby={reasonId}
          onClick={() => void submit()}
        >
          {submitting ? "กำลังส่งคำขอ…" : "สร้างไฟล์"}
        </Button>
      </div>
    </Dialog>
  );
}
