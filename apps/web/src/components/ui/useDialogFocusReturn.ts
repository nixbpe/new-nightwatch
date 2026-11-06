import { useEffect, type RefObject } from "react";

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
