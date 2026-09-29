import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "../../components/ui/button";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Confirmation overlay shared by member actions. The caller supplies the
 * consequence text and owns the mutation; the dialog owns focus: initial focus
 * on Cancel, a Tab trap, Escape and return to the opener (or `fallbackFocus`
 * once the opener is gone).
 */
export function MemberActionDialog({
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  pendingLabel,
  pending,
  opener,
  fallbackFocus,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Use "destructive" for irreversible actions such as revoking access. */
  confirmVariant?: "default" | "destructive";
  pendingLabel: string;
  pending: boolean;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    const fallback = fallbackFocus.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        dialog.current?.contains(event.target) === false
      ) {
        if (cancel.current !== null && !cancel.current.disabled)
          cancel.current.focus();
        else dialog.current.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (opener?.isConnected === true) opener.focus();
      else fallback?.focus();
    };
  }, [opener, fallbackFocus]);

  useEffect(() => {
    // The focused Confirm button is disabled while pending; keep focus in the dialog.
    if (pending) dialog.current?.focus();
  }, [pending]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first === undefined || last === undefined) {
      // Nothing is focusable while pending: keep focus on the dialog itself.
      event.preventDefault();
      dialog.current?.focus();
      return;
    }
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
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-md border border-foreground/10 bg-surface p-4 text-foreground shadow-lg focus:outline-none sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div
          id={descriptionId}
          className="mt-3 break-words text-sm leading-relaxed text-foreground-secondary"
        >
          {description}
        </div>
        <p role="status" className="mt-3 text-sm text-foreground-secondary">
          {pending ? pendingLabel : null}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            ref={cancel}
            type="button"
            variant="secondary"
            wrap
            disabled={pending}
            onClick={onCancel}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            wrap
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
