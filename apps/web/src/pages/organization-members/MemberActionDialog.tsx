import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../components/ui/button";

/** The caller supplies the action's consequence and owns its mutation. */
export function MemberActionDialog({
  title,
  description,
  confirmLabel,
  pending,
  opener,
  fallbackFocus,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const fallbackHeading = fallbackFocus.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !dialog.current?.contains(event.target)
      ) {
        (cancel.current?.disabled ? dialog.current : cancel.current)?.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (opener?.isConnected) opener.focus();
      else if (fallbackHeading?.isConnected) fallbackHeading.focus();
    };
  }, [opener, fallbackFocus]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !dialog.current?.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !dialog.current?.contains(document.activeElement))
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
        aria-labelledby="member-action-title"
        aria-describedby="member-action-description"
        onKeyDown={onKeyDown}
        tabIndex={-1}
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md border border-control-border bg-surface p-4 text-foreground shadow-lg sm:p-6"
      >
        <h2 id="member-action-title" className="text-xl font-semibold">
          {title}
        </h2>
        <p
          id="member-action-description"
          className="mt-4 break-words text-sm leading-relaxed text-foreground-secondary"
        >
          {description}
        </p>
        {pending && (
          <p role="status" className="mt-3 text-sm text-foreground-secondary">
            กำลังบันทึกบทบาท…
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 border-t border-foreground/10 pt-4 sm:flex-row sm:justify-end">
          <Button
            ref={cancel}
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            className="min-w-0 whitespace-normal break-words"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "กำลังบันทึกบทบาท…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
