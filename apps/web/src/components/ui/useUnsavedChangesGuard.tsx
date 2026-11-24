import { useEffect, useRef, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { ConfirmDialog } from "./confirm-dialog";

/**
 * The one rule for a form that keeps a draft until the user saves: while `dirty`, leaving the
 * page (another route, or closing the tab) asks first. Render the returned node anywhere in the
 * form; it is the confirm dialog and is `null` unless navigation is blocked. Needs a data router
 * (`useBlocker`); search-param changes on the same path do not block.
 */
export function useUnsavedChangesGuard(dirty: boolean): ReactNode {
  const opener = useRef<HTMLElement | null>(null);
  const noFallback = useRef<HTMLElement | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const block = dirty && currentLocation.pathname !== nextLocation.pathname;
    if (block && document.activeElement instanceof HTMLElement) {
      opener.current = document.activeElement;
    }
    return block;
  });

  useEffect(() => {
    if (blocker.state === "blocked" && !dirty) blocker.reset();
  }, [blocker, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  if (blocker.state !== "blocked") return null;
  return (
    <ConfirmDialog
      data-testid="unsaved-changes-dialog"
      confirmTestId="unsaved-changes-leave"
      title="ทิ้งการเปลี่ยนแปลงที่ยังไม่บันทึก?"
      description="ถ้าออกจากหน้านี้ ค่าที่แก้ไว้จะหายไป"
      confirmLabel="ทิ้งการเปลี่ยนแปลง"
      confirmVariant="destructive"
      pendingLabel="กำลังออก…"
      pending={false}
      opener={opener.current}
      fallbackFocus={noFallback}
      onCancel={() => {
        blocker.reset();
      }}
      onConfirm={() => {
        blocker.proceed();
      }}
    />
  );
}
