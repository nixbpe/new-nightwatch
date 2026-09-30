import {
  notificationItemParamsSchema,
  type NotificationItem,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/shell/EmptyState";
import {
  BellIcon,
  CheckIcon,
  ChevronLeftIcon,
  KeyIcon,
  LockIcon,
  MonitorIcon,
  ShieldIcon,
  SlidersIcon,
} from "../components/shell/icons";
import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { Notice } from "../components/ui/notice";
import { ApiError } from "../lib/api/client";
import {
  formatDateTime,
  usePreferences,
  type Preferences,
} from "../lib/preferences";
import {
  fetchNotifications,
  markAllNotificationsRead,
  notificationPageQueryKey,
  notificationQueryKey,
  openNotification,
  type NotificationPage,
} from "../lib/api/notifications";
import { useTenant } from "../lib/tenant/TenantProvider";
import { Card } from "../components/ui/card";
import { StatusPill } from "../components/ui/status-pill";
import { IconTile } from "../components/ui/icon-tile";

type MonitorNotificationItem = Extract<
  NotificationItem,
  { category: "monitor" }
>;

function itemTitle(item: NotificationItem) {
  if (item.scope === "organization") {
    switch (item.eventType) {
      case "ORG-NOTIFICATION-SETTINGS-CHANGED":
        return `การตั้งค่าการแจ้งเตือนเปลี่ยนโดย ${item.actor.displayName}`;
      case "MONITOR_DOWN":
        return `มอนิเตอร์ ${item.subject.monitorName} ล่ม`;
      case "MONITOR_RECOVERED":
        return `มอนิเตอร์ ${item.subject.monitorName} กลับมาทำงานแล้ว`;
      case "MONITOR_SSL_CAUTION":
        return `ใบรับรอง SSL ของ ${item.subject.monitorName} ใกล้หมดอายุ (เหลือไม่เกิน 30 วัน)`;
      case "MONITOR_SSL_DANGER":
        return `ใบรับรอง SSL ของ ${item.subject.monitorName} ใกล้หมดอายุมาก (เหลือไม่เกิน 7 วัน)`;
      case "MONITOR_SSL_EXPIRED":
        return `ใบรับรอง SSL ของ ${item.subject.monitorName} หมดอายุแล้ว`;
    }
  }
  if (item.eventType === "PASSWORD_CHANGED") return "มีการเปลี่ยนรหัสผ่าน";
  if (item.eventType === "MFA_ENABLED")
    return "เปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว";
  return "ปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว";
}
// Scope and category, rendered as two parts rather than one dotted string.
function itemContext(item: NotificationItem): [string, string] {
  if (item.scope !== "organization") return ["บัญชีของคุณ", "ความปลอดภัย"];
  return item.category === "monitor"
    ? ["องค์กร", "มอนิเตอร์"]
    : ["องค์กร", "การตั้งค่าการแจ้งเตือน"];
}
function ItemIcon({ item, size }: { item: NotificationItem; size: number }) {
  if (item.scope === "organization") {
    switch (item.eventType) {
      case "ORG-NOTIFICATION-SETTINGS-CHANGED":
        return <SlidersIcon size={size} />;
      case "MONITOR_DOWN":
        return <MonitorIcon size={size} />;
      case "MONITOR_RECOVERED":
        return <CheckIcon size={size} />;
      default:
        return <LockIcon size={size} />;
    }
  }
  if (item.eventType === "PASSWORD_CHANGED") return <KeyIcon size={size} />;
  return <ShieldIcon size={size} />;
}
const DOWN_REASONS: Record<string, string> = {
  http_status: "รหัสตอบกลับ HTTP ไม่อยู่ในช่วงที่คาดหวัง",
  assertion_failed: "ผลตอบกลับไม่ผ่านเงื่อนไขที่ตั้งไว้",
  timeout: "หมดเวลารอการตอบกลับ",
  dns_not_found: "ไม่พบชื่อโดเมนใน DNS",
  connect_refused: "ปลายทางปฏิเสธการเชื่อมต่อ",
  connect_failed: "เชื่อมต่อปลายทางไม่สำเร็จ",
  tls_invalid: "ใบรับรอง TLS ไม่ถูกต้อง",
  blocked_address: "ที่อยู่ปลายทางถูกบล็อก",
  redirect_blocked: "การเปลี่ยนเส้นทาง (redirect) ถูกบล็อก",
  redirect_limit: "เปลี่ยนเส้นทาง (redirect) เกินจำนวนที่กำหนด",
  body_read_failed: "อ่านเนื้อหาตอบกลับไม่สำเร็จ",
};
function downReason(reason: string) {
  return DOWN_REASONS[reason] ?? reason;
}
/** Monitor items link to the Detail page; a deleted monitor is reported there. */
function monitorPath(item: MonitorNotificationItem) {
  return `/organizations/${item.organizationId}/monitors/${item.subject.monitorId}`;
}
function MonitorFacts({
  item,
  preferences,
}: {
  item: MonitorNotificationItem;
  preferences: Preferences;
}) {
  if (item.eventType === "MONITOR_DOWN") {
    return <span>สาเหตุ: {downReason(item.reason)}</span>;
  }
  if (item.sslNotAfter === null) return null;
  return (
    <span>
      {item.eventType === "MONITOR_SSL_EXPIRED"
        ? "ใบรับรองหมดอายุเมื่อ "
        : "ใบรับรองหมดอายุ "}
      <time dateTime={item.sslNotAfter} className="font-mono">
        {itemTime(item.sslNotAfter, preferences)}
      </time>
    </span>
  );
}
// Absolute times follow the time zone and hour cycle chosen on /settings/display.
function itemTime(value: string, preferences: Preferences) {
  return formatDateTime(new Date(value), preferences);
}
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
];
/** "5 นาทีที่แล้ว" for the last week; the absolute time beyond that. */
function relativeTime(value: string, preferences: Preferences) {
  let elapsed = (Date.now() - new Date(value).getTime()) / 60_000;
  if (elapsed < 1) return "เมื่อสักครู่";
  const format = new Intl.RelativeTimeFormat("th-TH", { numeric: "auto" });
  for (const [unit, next] of RELATIVE_UNITS) {
    if (elapsed < next) return format.format(-Math.floor(elapsed), unit);
    elapsed /= next;
  }
  return itemTime(value, preferences);
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
  onNavigate,
  popoverItems = false,
}: {
  items: NotificationItem[];
  onOpen: (id: string) => void;
  /** Called when a monitor link is followed (the popover closes itself). */
  onNavigate?: () => void;
  popoverItems?: boolean;
}) {
  const { preferences } = usePreferences();
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
            className="relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-100 hover:surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            {item.readAt === null ? (
              <span
                aria-label="ยังไม่อ่าน"
                className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-foreground"
              />
            ) : null}
            <IconTile size={32}>
              <ItemIcon item={item} size={16} />
            </IconTile>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={`text-sm ${item.readAt === null ? "font-medium" : ""}`}
              >
                {itemTitle(item)}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-foreground-secondary">
                {itemContext(item).map((part) => (
                  <span key={part}>{part}</span>
                ))}
                <time
                  dateTime={item.occurredAt}
                  title={itemTime(item.occurredAt, preferences)}
                  className="font-mono text-xs text-foreground"
                >
                  {relativeTime(item.occurredAt, preferences)}
                </time>
              </span>
              {item.scope === "organization" && item.category === "monitor" ? (
                <span className="text-xs text-foreground-secondary">
                  <MonitorFacts item={item} preferences={preferences} />
                </span>
              ) : null}
            </span>
          </button>
          {item.scope === "organization" && item.category === "monitor" ? (
            <Link
              to={monitorPath(item)}
              onClick={onNavigate}
              data-popover-item={popoverItems ? "" : undefined}
              className="mb-3 ml-[60px] inline-block text-xs text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              เปิดมอนิเตอร์
              <span className="sr-only"> {item.subject.monitorName}</span>
            </Link>
          ) : null}
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
  const { preferences } = usePreferences();
  const client = useQueryClient();
  const [detailId, setDetailId] = useState(initialDetailId);
  // Later pages are valid only for the first page whose cursor chain they continue; a refetched first page drops them.
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
      <Button
        variant="ghost"
        className="-ml-3 gap-1 self-start"
        onClick={closeDetail}
      >
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
        <Page>
          {backButton}
          <PageState kind="loading" label="กำลังเปิดการแจ้งเตือน…" />
        </Page>
      );
    }
    if (open.isError) {
      return (
        <Page>
          {backButton}
          <PageState kind="error" message={problem(open.error)} />
        </Page>
      );
    }
    const detail = open.data;
    return (
      <Page>
        {backButton}
        <PageHeader
          scope={{ label: itemContext(detail)[0], tag: itemContext(detail)[1] }}
          title={itemTitle(detail)}
        />
        <Card as="article">
          <dl className="grid gap-x-8 gap-y-1 p-6 text-sm sm:grid-cols-[max-content_1fr] sm:gap-y-4">
            <dt className="text-foreground-secondary">สถานะ</dt>
            <dd className="mb-3 sm:mb-0">
              <StatusPill dot>
                {detail.readAt === null ? "ยังไม่อ่าน" : "อ่านแล้ว"}
              </StatusPill>
            </dd>
            <dt className="text-foreground-secondary">เวลาที่เกิดเหตุการณ์</dt>
            <dd className="mb-3 sm:mb-0">
              <time dateTime={detail.occurredAt} className="font-mono">
                {itemTime(detail.occurredAt, preferences)}
              </time>
            </dd>
            {detail.readAt === null ? null : (
              <>
                <dt className="text-foreground-secondary">อ่านเมื่อ</dt>
                <dd className="mb-3 sm:mb-0">
                  <time dateTime={detail.readAt} className="font-mono">
                    {itemTime(detail.readAt, preferences)}
                  </time>
                </dd>
              </>
            )}
            {detail.scope === "organization" && detail.actor !== null ? (
              <>
                <dt className="text-foreground-secondary">ผู้เปลี่ยนแปลง</dt>
                <dd>{detail.actor.displayName}</dd>
              </>
            ) : null}
            {detail.scope === "organization" &&
            detail.category === "monitor" ? (
              <>
                <dt className="text-foreground-secondary">มอนิเตอร์</dt>
                <dd className="mb-3 sm:mb-0">
                  <Link
                    to={monitorPath(detail)}
                    className="text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    เปิดมอนิเตอร์
                    <span className="sr-only">
                      {" "}
                      {detail.subject.monitorName}
                    </span>
                  </Link>{" "}
                  <span className="text-foreground-secondary">
                    ({detail.subject.monitorName})
                  </span>
                </dd>
                <dt className="text-foreground-secondary">รายละเอียด</dt>
                <dd>
                  <MonitorFacts item={detail} preferences={preferences} />
                </dd>
              </>
            ) : null}
          </dl>
        </Card>
      </Page>
    );
  }
  const scope = {
    label: "บัญชีของคุณ",
    tag:
      serverActiveOrgId === null ? "ไม่มีองค์กรที่ใช้งาน" : "องค์กรที่ใช้งาน",
  };
  if (list.isPending)
    return (
      <Page>
        <PageHeader scope={scope} title="การแจ้งเตือน" />
        <PageState
          kind="loading"
          label="กำลังโหลดการแจ้งเตือน…"
          layout="rows"
        />
      </Page>
    );
  if (list.isError)
    return (
      <Page>
        <PageHeader scope={scope} title="การแจ้งเตือน" />
        <PageState
          kind="error"
          message={problem(list.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void list.refetch()}
        />
      </Page>
    );
  const { unreadCount } = list.data;
  return (
    <Page>
      <PageHeader
        scope={scope}
        title="การแจ้งเตือน"
        status={
          <span>
            {unreadCount === 0 ? (
              "อ่านครบทุกรายการแล้ว"
            ) : (
              <>
                ยังไม่อ่าน <span className="font-mono">{unreadCount}</span>{" "}
                รายการ
              </>
            )}
          </span>
        }
        actions={
          <Button
            variant="secondary"
            className="h-auto min-h-10 w-full max-w-full break-words whitespace-normal sm:w-auto"
            disabled={unreadCount === 0 || all.isPending}
            onClick={() => {
              all.mutate(serverActiveOrgId);
            }}
          >
            ทำเครื่องหมายว่าอ่านทั้งหมด
          </Button>
        }
      />
      {all.isError ? (
        <Alert tone="error">
          ทำเครื่องหมายว่าอ่านทั้งหมดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </Alert>
      ) : null}
      {all.isSuccess && unreadCount === 0 ? (
        <Notice tone="success">ทำเครื่องหมายว่าอ่านแล้วทั้งหมด</Notice>
      ) : null}
      <div>
        {items.length === 0 ? (
          <EmptyState
            icon={<BellIcon size={20} />}
            title="ยังไม่มีการแจ้งเตือน"
            description="เหตุการณ์ด้านความปลอดภัยของบัญชี การเปลี่ยนแปลงขององค์กรและสถานะมอนิเตอร์จะแสดงที่นี่"
          />
        ) : (
          <Card className="overflow-hidden">
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
          </Card>
        )}
      </div>
    </Page>
  );
}
