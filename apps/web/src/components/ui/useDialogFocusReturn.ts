import { useEffect, type KeyboardEvent, type RefObject } from "react";

export function trapDialogTab(
  event: KeyboardEvent,
  dialog: HTMLElement | null,
  focusable: string,
) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    dialog?.querySelectorAll<HTMLElement>(focusable) ?? [],
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (first === undefined || last === undefined) return;
  const outside = dialog?.contains(document.activeElement) !== true;
  if (event.shiftKey && (document.activeElement === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

export function useDialogFocusReturn(
  dialog: RefObject<HTMLElement | null>,
  initialFocus: RefObject<HTMLElement | null>,
  opener: HTMLElement | null,
  fallbackFocus: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    initialFocus.current?.focus();
    // Keep the mount's return target even if React clears or replaces the ref.
    const fallback = fallbackFocus.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        dialog.current?.contains(event.target) === false
      ) {
        initialFocus.current?.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (opener?.isConnected === true) opener.focus();
      else fallback?.focus();
    };
  }, [dialog, initialFocus, opener, fallbackFocus]);
}
