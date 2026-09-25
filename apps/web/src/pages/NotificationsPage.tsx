import {
  notificationItemParamsSchema,
  type NotificationItem,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { useEffect, useRef, useState } from "react";

import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { ApiError } from "../lib/api/client";
import {
  fetchNotifications,
  markAllNotificationsRead,
  notificationPageQueryKey,
  notificationQueryKey,
  openNotification,
  type NotificationPage,
} from "../lib/api/notifications";
import { useTenant } from "../lib/tenant/TenantProvider";

function itemTitle(item: NotificationItem) {
  if (item.scope === "organization") {
    return `การตั้งค่าการแจ้งเตือนเปลี่ยนโดย ${item.actor.displayName}`;
  }
  if (item.eventType === "PASSWORD_CHANGED") return "มีการเปลี่ยนรหัสผ่าน";
  if (item.eventType === "MFA_ENABLED")
    return "เปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว";
  return "ปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว";
}
function itemTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function problem(error: unknown) {
  if (
    error instanceof ApiError &&
    ["PERMISSION_DENIED", "MEMBERSHIP_DENIED"].includes(error.code)
  ) {
    return "คุณไม่มีสิทธิ์ดูการแจ้งเตือนนี้";
  }
  if (error instanceof ApiError && error.code === "NOTIFICATION_NOT_FOUND") {
    return "ไม่พบการแจ้งเตือนนี้";
  }
  return "โหลดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}
function notificationIdFromNavigation(
  state: unknown,
  serverActiveOrgId: string | null,
): string | null {
  if (typeof state !== "object" || state === null) return null;
  const navigation = state as {
    notificationId?: unknown;
    notificationOrganizationId?: unknown;
  };
  if (navigation.notificationOrganizationId !== serverActiveOrgId) return null;
  const notification = notificationItemParamsSchema.safeParse({
    id: navigation.notificationId,
  });
  return notification.success ? notification.data.id : null;
}

export function NotificationRows({
  items,
  onOpen,
  popoverItems = false,
}: {
  items: NotificationItem[];
  onOpen: (id: string) => void;
  popoverItems?: boolean;
}) {
  return (
    <ul className="divide-y divide-foreground/10">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => {
              onOpen(item.id);
            }}
            data-popover-item={popoverItems ? "" : undefined}
            className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            <span className="flex items-center gap-2 font-medium">
              {item.readAt === null ? (
                <span
                  aria-label="ยังไม่อ่าน"
                  className="h-2 w-2 shrink-0 rounded-full bg-primary"
                />
              ) : null}
              {itemTitle(item)}
            </span>
            <span className="text-xs text-foreground-secondary">
              {itemTime(item.occurredAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
export function NotificationsPage() {
  const { serverActiveOrgId } = useTenant();
  const location = useLocation();
  const state: unknown = location.state;
  return (
    <NotificationsPageForOrganization
      key={`${serverActiveOrgId ?? "account"}:${location.key}`}
      initialDetailId={notificationIdFromNavigation(state, serverActiveOrgId)}
      serverActiveOrgId={serverActiveOrgId}
    />
  );
}

function NotificationsPageForOrganization({
  initialDetailId,
  serverActiveOrgId,
}: {
  initialDetailId: string | null;
  serverActiveOrgId: string | null;
}) {
  const client = useQueryClient();
  const [detailId, setDetailId] = useState(initialDetailId);
  const [pages, setPages] = useState<NotificationPage[]>([]);
  const [loadingNextPage, setLoadingNextPage] = useState(false);
  const openedInitialDetail = useRef(false);
  const list = useQuery({
    queryKey: notificationQueryKey(serverActiveOrgId),
    queryFn: () => fetchNotifications(serverActiveOrgId),
  });
  const open = useMutation({
    mutationFn: openNotification,
    onSuccess: async () => {
      setPages([]);
      await client.invalidateQueries({
        queryKey: notificationQueryKey(serverActiveOrgId),
      });
    },
  });
  const all = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      setPages([]);
      await client.invalidateQueries({
        queryKey: notificationQueryKey(serverActiveOrgId),
      });
    },
  });

  useEffect(() => {
    if (initialDetailId === null || openedInitialDetail.current) return;
    openedInitialDetail.current = true;
    open.mutate(initialDetailId);
  }, [initialDetailId, open]);

  const loadedPages = list.data === undefined ? [] : [list.data, ...pages];
  const items = loadedPages.flatMap((page) => page.items);
  const nextCursor = loadedPages.at(-1)?.nextCursor ?? null;

  async function loadNextPage() {
    if (nextCursor === null || loadingNextPage) return;
    setLoadingNextPage(true);
    try {
      const nextPage = await client.query({
        queryKey: notificationPageQueryKey(serverActiveOrgId, nextCursor),
        queryFn: () => fetchNotifications(serverActiveOrgId, nextCursor),
        staleTime: Infinity,
      });
      setPages((current) => [...current, nextPage]);
    } finally {
      setLoadingNextPage(false);
    }
  }

  function closeDetail() {
    open.reset();
    setDetailId(null);
  }

  function requestOpen(id: string) {
    open.reset();
    setDetailId(id);
    open.mutate(id);
  }

  if (detailId !== null) {
    if (
      open.isIdle ||
      open.isPending ||
      (open.data !== undefined && open.data.id !== detailId)
    ) {
      return <div role="status">กำลังเปิดการแจ้งเตือน…</div>;
    }
    if (open.isError) {
      return (
        <section className="max-w-2xl">
          <Button variant="ghost" onClick={closeDetail}>
            กลับไปที่การแจ้งเตือน
          </Button>
          <Alert tone="error">{problem(open.error)}</Alert>
        </section>
      );
    }
    return (
      <section className="max-w-2xl">
        <Button variant="ghost" onClick={closeDetail}>
          กลับไปที่การแจ้งเตือน
        </Button>
        <h1 className="mt-4 text-2xl font-semibold">{itemTitle(open.data)}</h1>
        <p className="mt-2 text-sm text-foreground-secondary">
          {itemTime(open.data.occurredAt)}
        </p>
        <p className="mt-6 text-sm">
          สถานะ: {open.data.readAt === null ? "ยังไม่อ่าน" : "อ่านแล้ว"}
        </p>
      </section>
    );
  }
  if (list.isPending)
    return (
      <div
        role="status"
        className="rounded-md border border-foreground/10 bg-surface p-6"
      >
        กำลังโหลดการแจ้งเตือน…
      </div>
    );
  if (list.isError)
    return (
      <section>
        <Alert tone="error">{problem(list.error)}</Alert>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => void list.refetch()}
        >
          ลองใหม่
        </Button>
      </section>
    );
  return (
    <section className="max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-foreground-secondary">
            บัญชีของคุณ
            {serverActiveOrgId === null
              ? " · ไม่มีองค์กรที่ใช้งาน"
              : " · องค์กรที่ใช้งาน"}
          </p>
          <h1 className="text-2xl font-semibold">การแจ้งเตือน</h1>
        </div>
        <Button
          variant="secondary"
          className="h-auto min-h-9 w-full max-w-full break-words whitespace-normal sm:w-auto"
          disabled={list.data.unreadCount === 0 || all.isPending}
          onClick={() => {
            all.mutate();
          }}
        >
          ทำเครื่องหมายว่าอ่านทั้งหมด
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="mt-6 rounded-md border border-dashed border-foreground/10 p-8 text-center text-sm text-foreground-secondary">
          ยังไม่มีการแจ้งเตือน
        </p>
      ) : (
        <div className="mt-6 rounded-md border border-foreground/10 bg-surface">
          <NotificationRows items={items} onOpen={requestOpen} />
        </div>
      )}
      {nextCursor === null ? null : (
        <Button
          className="mt-4"
          variant="secondary"
          disabled={loadingNextPage}
          onClick={() => void loadNextPage()}
        >
          {loadingNextPage
            ? "กำลังโหลดเพิ่มเติม…"
            : "โหลดการแจ้งเตือนเพิ่มเติม"}
        </Button>
      )}
    </section>
  );
}
