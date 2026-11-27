import { useCallback, useEffect, useRef, useState } from "react";

const ITEM_SELECTOR =
  '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"]), [data-popover-item]:not([disabled])';

// Escape, an outside click and `close()` return focus to the trigger; focus moving elsewhere closes the panel and stays there,
// except into a modal dialog opened from it (the command palette), whose opener must still be in the page when it closes.
export function usePopover<TTrigger extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<TTrigger>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const items = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    (items()[0] ?? panel).focus();

    const closeAndReturn = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        panel.contains(target) ||
        triggerRef.current?.contains(target) === true
      ) {
        return;
      }
      closeAndReturn();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !panel.contains(target) &&
        triggerRef.current?.contains(target) !== true &&
        target.closest('[aria-modal="true"]') === null
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndReturn();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      const list = items();
      if (list.length === 0) {
        return;
      }
      event.preventDefault();
      const current = list.findIndex((item) => item === document.activeElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next =
        current === -1
          ? delta === 1
            ? 0
            : list.length - 1
          : (current + delta + list.length) % list.length;
      list[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  return { open, toggle, close, triggerRef, panelRef };
}
