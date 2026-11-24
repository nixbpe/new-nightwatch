import {
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { trapDialogTab, useDialogFocusReturn } from "./useDialogFocusReturn";

const FOCUSABLE = [
  "a[href]",
  'button:not(:disabled):not([tabindex="-1"])',
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(",");

// Complete class strings so Tailwind can see them.
const SIZE_CLASS = {
  md: "max-w-[520px]",
  lg: "max-w-[560px]",
  xl: "max-w-[640px]",
} as const;

/**
 * Modal shell (CMP-03, LAY-07). Focus returns to `opener` (or `fallbackFocus` once it is gone);
 * a scrim click does nothing. The caller owns the body and footer (use the `px-4 sm:px-6`
 * rhythm), the mutation, and whether `onClose` may act while busy.
 */
export function Dialog({
  title,
  titleTestId,
  description,
  descriptionTestId,
  size = "md",
  busy = false,
  opener,
  fallbackFocus,
  initialFocus,
  dialogRef,
  onClose,
  children,
  "data-testid": testId,
}: {
  "data-testid"?: string;
  title: ReactNode;
  titleTestId?: string;
  description?: ReactNode;
  descriptionTestId?: string;
  /** Panel max width: md 520 px, lg 560 px, xl 640 px. */
  size?: keyof typeof SIZE_CLASS;
  busy?: boolean;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  /** The control that takes focus on open and when focus escapes the dialog. */
  initialFocus: RefObject<HTMLElement | null>;
  dialogRef?: RefObject<HTMLDivElement | null>;
  /** Called on Escape; the caller decides whether to ignore it while busy. */
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const ownRef = useRef<HTMLDivElement>(null);
  const dialog = dialogRef ?? ownRef;

  useDialogFocusReturn(dialog, initialFocus, opener, fallbackFocus);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    trapDialogTab(event, dialog.current, FOCUSABLE);
  }

  return createPortal(
    <div className="backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        ref={dialog}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-busy={busy ? true : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`overlay-enter flex max-h-[calc(100dvh-2rem)] w-full ${SIZE_CLASS[size]} flex-col rounded-md border border-foreground/10 bg-surface text-foreground shadow-modal focus:outline-none`}
      >
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <h2
            id={titleId}
            data-testid={titleTestId}
            className="text-xl font-semibold break-words text-heading"
          >
            {title}
          </h2>
          {description === undefined ? null : (
            <p
              id={descriptionId}
              data-testid={descriptionTestId}
              className="mt-1 text-sm break-words text-foreground-secondary"
            >
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
