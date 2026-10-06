import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import {
  UNSAFE_DataRouterContext,
  useLocation,
  type createBrowserRouter,
} from "react-router";

import { getContextPublicationSnapshot } from "../../lib/queryClient";
import { useTenant } from "../../lib/tenant/TenantProvider";

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

function noticeKeyOf(state: unknown): MonitorNoticeKey | null {
  if (typeof state !== "object" || state === null || !("notice" in state)) {
    return null;
  }
  const key = state.notice;
  return typeof key === "string" && isNoticeKey(key) ? key : null;
}

export async function consumeMonitorFlash(
  router: ReturnType<typeof createBrowserRouter>,
  queryClient: QueryClient,
  expected: { key: string; notice: MonitorNoticeKey },
  heading: HTMLHeadingElement | null,
): Promise<boolean> {
  const current = router.state;
  if (
    current.location.key !== expected.key ||
    noticeKeyOf(current.location.state) !== expected.notice ||
    current.navigation.state !== "idle" ||
    current.revalidation !== "idle" ||
    getContextPublicationSnapshot(queryClient).admission.kind !== "confirmed"
  )
    return false;
  heading?.focus();
  await router.navigate(
    current.location.pathname + current.location.search + current.location.hash,
    { replace: true, state: null, defaultShouldRevalidate: false },
  );
  return true;
}

/**
 * Reads the notice the previous page left in router state, moves focus to the
 * page heading (`tabIndex={-1}`) once, and clears the state so a reload or a
 * back navigation does not show it again.
 */
export function useFlashNotice() {
  const location = useLocation();
  const routerContext = useContext(UNSAFE_DataRouterContext);
  const queryClient = useQueryClient();
  const { me } = useTenant();
  const [flash] = useState(() => {
    const notice = noticeKeyOf(location.state);
    return notice === null ? null : { key: location.key, notice };
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (flash === null) return;
    if (routerContext === null)
      throw new Error("Monitor flash requires a data router");
    void consumeMonitorFlash(
      routerContext.router,
      queryClient,
      flash,
      heading.current,
    );
  }, [flash, location.key, me, queryClient, routerContext]);
  return {
    notice: flash === null ? null : MONITOR_NOTICES[flash.notice],
    heading,
  };
}
