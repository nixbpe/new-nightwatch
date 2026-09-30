import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/** The fixed messages a monitor page can hand to the next one; the state carries only the key. */
export const MONITOR_NOTICES = {
  created: "สร้างมอนิเตอร์แล้ว",
  updated: "บันทึกการแก้ไขแล้ว",
  deleted: "ลบมอนิเตอร์แล้ว",
  alreadyDeleted: "มอนิเตอร์นี้ถูกลบแล้ว",
} as const;
export type MonitorNoticeKey = keyof typeof MONITOR_NOTICES;

/** Router state a monitor page sets when it hands a one-time notice to the next page. */
export type MonitorFlashState = { notice: MonitorNoticeKey };

function isNoticeKey(key: string): key is MonitorNoticeKey {
  return Object.hasOwn(MONITOR_NOTICES, key);
}

function noticeOf(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("notice" in state)) {
    return null;
  }
  const key = state.notice;
  return typeof key === "string" && isNoticeKey(key)
    ? MONITOR_NOTICES[key]
    : null;
}

/**
 * Reads the notice the previous page left in router state, moves focus to the
 * page heading (`tabIndex={-1}`) once, and clears the state so a reload or a
 * back navigation does not show it again.
 */
export function useFlashNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => noticeOf(location.state));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (notice === null) return;
    heading.current?.focus();
    void navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
    // Runs once for the notice this mount received.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { notice, heading };
}
