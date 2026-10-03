import { AUDIT_EXPORT_MAX_EVENTS } from "@nightwatch/api-contract";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "../../components/ui/button";
import {
  EMPTY_REASON,
  REQUEST_FAILED_IN_DIALOG,
  tooLargeText,
  type ExportOutcome,
} from "./exports";
import { RecordingScopeNote } from "./RecordingScopeNote";

const FOCUSABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
// the content scrolls inside while the title and the buttons stay in view. Same scrim,
// shadow and focus trap (LAY-07, CMP-03).
export function ExportDialog({
  scope,
  opener,
  fallbackFocus,
  onSubmit,
  onCancel,
}: {
  scope: ExportDialogScope;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  /** Resolves with what the server said; the caller closes the dialog on `created`, `in-progress` and `denied`. */
  onSubmit: (format: "csv" | "json") => Promise<ExportOutcome>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const firstFormat = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [total, setTotal] = useState(scope.total);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const tooLarge = total > AUDIT_EXPORT_MAX_EVENTS;

  useEffect(() => {
    firstFormat.current?.focus();
    const fallback = fallbackFocus.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        dialog.current?.contains(event.target) === false
      ) {
        firstFormat.current?.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (opener?.isConnected === true) opener.focus();
      else fallback?.focus();
    };
  }, [opener, fallbackFocus]);

  const cancel = () => {
    if (!inFlight.current) onCancel();
  };

  const submit = async () => {
    // Pressing again while a request is out changes nothing (M-3).
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first === undefined || last === undefined) return;
    const outside = dialog.current?.contains(document.activeElement) !== true;
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || outside)
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const reasonId = tooLarge ? messageId : undefined;
  return createPortal(
    <div className="backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={submitting ? true : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="overlay-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-[520px] flex-col rounded-md border border-foreground/10 bg-surface text-foreground shadow-modal focus:outline-none"
      >
        <h2
          id={titleId}
          className="px-4 pt-4 text-lg font-semibold text-heading sm:px-6 sm:pt-6"
        >
          ส่งออกบันทึกกิจกรรม
        </h2>
        <div
          tabIndex={0}
          role="region"
          aria-label="รายละเอียดการส่งออก"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-6"
        >
          <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
            <dt className="text-foreground-secondary">ขอบเขต</dt>
            <dd className="break-words">
              <span className="font-mono">{scope.rangeText}</span> (
              {scope.timeZone})
            </dd>
            <dt className="text-foreground-secondary">ตัวกรอง</dt>
            <dd className="break-words">{scope.filtersText}</dd>
            <dt className="text-foreground-secondary">จำนวน</dt>
            <dd>
              <span className="font-mono">{total.toLocaleString("en-US")}</span>{" "}
              รายการ
            </dd>
          </dl>
          <p className="text-foreground-secondary">
            ณ โหลดเมื่อ <span className="font-mono">{scope.loadedAt}</span> (
            {scope.timeZone})
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">รูปแบบไฟล์</legend>
            {(["csv", "json"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  ref={value === "csv" ? firstFormat : undefined}
                  type="radio"
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
            <p id={messageId} role="alert" className="text-danger">
              {tooLargeText(total)}
            </p>
          ) : null}
          {message === null ? null : (
            <p role="alert" className="text-danger">
              {message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-foreground/10 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="secondary"
            wrap
            aria-disabled={submitting ? true : undefined}
            onClick={cancel}
          >
            ยกเลิก
          </Button>
          <Button
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
      </div>
    </div>,
    document.body,
  );
}
