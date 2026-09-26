import {
  notificationItemParamsSchema,
  type NotificationItem,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/shell/EmptyState";
import {
  BellIcon,
  ChevronLeftIcon,
  KeyIcon,
  ShieldIcon,
  SlidersIcon,
} from "../components/shell/icons";
import { Skeleton } from "../components/shell/Skeleton";
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
function itemContext(item: NotificationItem) {
  return item.scope === "organization"
    ? "องค์กร · การตั้งค่าการแจ้งเตือน"
    : "บัญชีของคุณ · ความปลอดภัย";
}
function ItemIcon({ item, size }: { item: NotificationItem; size: number }) {
  if (item.scope === "organization") return <SlidersIcon size={size} />;
  if (item.eventType === "PASSWORD_CHANGED") return <KeyIcon size={size} />;
  return <ShieldIcon size={size} />;
}
function itemTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
];
/** "5 นาทีที่แล้ว" for the last week; the absolute time beyond that. */
function relativeTime(value: string) {
  let elapsed = (Date.now() - new Date(value).getTime()) / 60_000;
  if (elapsed < 1) return "เมื่อสักครู่";
  const format = new Intl.RelativeTimeFormat("th-TH", { numeric: "auto" });
  for (const [unit, next] of RELATIVE_UNITS) {
    if (elapsed < next) return format.format(-Math.floor(elapsed), unit);
    elapsed /= next;
  }
  return itemTime(value);
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
            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            <span className="flex h-8 w-2 shrink-0 items-center">
              {item.readAt === null ? (
                <span
                  aria-label="ยังไม่อ่าน"
                  className="h-2 w-2 rounded-full bg-primary"
                />
              ) : null}
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-background text-foreground-secondary">
              <ItemIcon item={item} size={16} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={item.readAt === null ? "font-medium" : undefined}
              >
                {itemTitle(item)}
              </span>
              <span className="text-sm text-foreground-secondary">
                {itemContext(item)}
              </span>
              <time
                dateTime={item.occurredAt}
                title={itemTime(item.occurredAt)}
                className="font-mono text-xs text-foreground-secondary"
              >
                {relativeTime(item.occurredAt)}
              </time>
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
  // Later pages are only valid for the first page whose cursor chain they
  // continue; a refetched first page with new data drops them.
  const [retained, setRetained] = useState<{
    firstPage: NotificationPage;
    pages: NotificationPage[];
  } | null>(null);
  const [loadingNextPage, setLoadingNextPage] = useState(false);
  const [nextPageError, setNextPageError] = useState<unknown>(null);
  const openedInitialDetail = useRef(false);
  const list = useQuery({
    queryKey: notificationQueryKey(serverActiveOrgId),
    queryFn: () => fetchNotifications(serverActiveOrgId),
  });
  const open = useMutation({
    mutationFn: openNotification,
    onSuccess: async () => {
      setRetained(null);
      setNextPageError(null);
      await client.invalidateQueries({
        queryKey: notificationQueryKey(serverActiveOrgId),
      });
    },
  });
  const all = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      setRetained(null);
      setNextPageError(null);
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

  const pages =
    retained !== null && retained.firstPage === list.data ? retained.pages : [];
  const loadedPages = list.data === undefined ? [] : [list.data, ...pages];
  const items = loadedPages.flatMap((page) => page.items);
  const nextCursor = loadedPages.at(-1)?.nextCursor ?? null;

  async function loadNextPage() {
    const firstPage = list.data;
    if (firstPage === undefined || nextCursor === null || loadingNextPage)
      return;
    setLoadingNextPage(true);
    setNextPageError(null);
    try {
      const nextPage = await client.query({
        queryKey: notificationPageQueryKey(serverActiveOrgId, nextCursor),
        queryFn: () => fetchNotifications(serverActiveOrgId, nextCursor),
        staleTime: Infinity,
      });
      setRetained({ firstPage, pages: [...pages, nextPage] });
    } catch (error) {
      setNextPageError(error);
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
    const backButton = (
      <Button variant="ghost" className="-ml-3 gap-1" onClick={closeDetail}>
        <ChevronLeftIcon />
        กลับไปที่การแจ้งเตือน
      </Button>
    );
    if (
      open.isIdle ||
      open.isPending ||
      (open.data !== undefined && open.data.id !== detailId)
    ) {
      return (
        <section className="max-w-3xl">
          {backButton}
          <div
            role="status"
            className="mt-4 flex gap-4 rounded-md border border-foreground/10 bg-surface p-6"
          >
            <span className="sr-only">กำลังเปิดการแจ้งเตือน…</span>
            <Skeleton className="h-10 w-10 shrink-0" />
            <span className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-64 max-w-full" />
            </span>
          </div>
        </section>
      );
    }
    if (open.isError) {
      return (
        <section className="max-w-3xl">
          {backButton}
          <div className="mt-4">
            <Alert tone="error">{problem(open.error)}</Alert>
          </div>
        </section>
      );
    }
    const detail = open.data;
    return (
      <section className="max-w-3xl">
        {backButton}
        <article className="mt-4 rounded-md border border-foreground/10 bg-surface">
          <header className="flex items-start gap-4 border-b border-foreground/10 p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-background text-foreground-secondary">
              <ItemIcon item={detail} size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-foreground-secondary">
                {itemContext(detail)}
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                {itemTitle(detail)}
              </h1>
            </div>
          </header>
          <dl className="grid gap-x-8 gap-y-1 p-6 text-sm sm:grid-cols-[max-content_1fr] sm:gap-y-4">
            <dt className="text-foreground-secondary">สถานะ</dt>
            <dd className="mb-3 sm:mb-0">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 px-2 py-0.5 text-xs">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    detail.readAt === null
                      ? "bg-primary"
                      : "bg-foreground-secondary"
                  }`}
                />
                {detail.readAt === null ? "ยังไม่อ่าน" : "อ่านแล้ว"}
              </span>
            </dd>
            <dt className="text-foreground-secondary">เวลาที่เกิดเหตุการณ์</dt>
            <dd className="mb-3 sm:mb-0">
              <time dateTime={detail.occurredAt} className="font-mono">
                {itemTime(detail.occurredAt)}
              </time>
            </dd>
            {detail.readAt === null ? null : (
              <>
                <dt className="text-foreground-secondary">อ่านเมื่อ</dt>
                <dd className="mb-3 sm:mb-0">
                  <time dateTime={detail.readAt} className="font-mono">
                    {itemTime(detail.readAt)}
                  </time>
                </dd>
              </>
            )}
            {detail.scope === "organization" ? (
              <>
                <dt className="text-foreground-secondary">ผู้เปลี่ยนแปลง</dt>
                <dd>{detail.actor.displayName}</dd>
              </>
            ) : null}
          </dl>
        </article>
      </section>
    );
  }
  if (list.isPending)
    return (
      <section className="max-w-3xl">
        <div
          role="status"
          className="rounded-md border border-foreground/10 bg-surface"
        >
          <span className="sr-only">กำลังโหลดการแจ้งเตือน…</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0"
            >
              <Skeleton className="ml-5 h-8 w-8 shrink-0" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-32" />
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  if (list.isError)
    return (
      <section className="max-w-3xl">
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
  const { unreadCount } = list.data;
  return (
    <section className="max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-foreground-secondary">
            บัญชีของคุณ
            {serverActiveOrgId === null
              ? " · ไม่มีองค์กรที่ใช้งาน"
              : " · องค์กรที่ใช้งาน"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">การแจ้งเตือน</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            {unreadCount === 0 ? (
              "อ่านครบทุกรายการแล้ว"
            ) : (
              <>
                ยังไม่อ่าน <span className="font-mono">{unreadCount}</span>{" "}
                รายการ
              </>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          className="h-auto min-h-9 w-full max-w-full break-words whitespace-normal sm:w-auto"
          disabled={unreadCount === 0 || all.isPending}
          onClick={() => {
            all.mutate();
          }}
        >
          ทำเครื่องหมายว่าอ่านทั้งหมด
        </Button>
      </header>
      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<BellIcon size={20} />}
            title="ยังไม่มีการแจ้งเตือน"
            description="เหตุการณ์ด้านความปลอดภัยของบัญชีและการเปลี่ยนแปลงขององค์กรจะแสดงที่นี่"
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-foreground/10 bg-surface">
            <NotificationRows items={items} onOpen={requestOpen} />
            {nextCursor === null ? null : (
              <div className="border-t border-foreground/10 p-2">
                {nextPageError === null ? null : (
                  <div className="mb-2">
                    <Alert tone="error">{problem(nextPageError)}</Alert>
                  </div>
                )}
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={loadingNextPage}
                  onClick={() => void loadNextPage()}
                >
                  {loadingNextPage
                    ? "กำลังโหลดเพิ่มเติม…"
                    : "โหลดการแจ้งเตือนเพิ่มเติม"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
