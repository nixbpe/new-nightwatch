import {
  notificationItemParamsSchema,
  type NotificationItem,
} from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "../components/shell/EmptyState";
import {
  BellIcon,
  CheckIcon,
  ChevronLeftIcon,
  DownloadIcon,
  HistoryIcon,
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
import { SectionHeader } from "../components/ui/section-header";
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
  notificationPagesQueryKey,
  notificationFilteredQueryKey,
  normalizeNotificationFilters,
  notificationQueryKey,
  openNotification,
  type NotificationPage,
} from "../lib/api/notifications";
import { useTenant } from "../lib/tenant/TenantProvider";
import { Card } from "../components/ui/card";
import { StatusPill } from "../components/ui/status-pill";

type MonitorNotificationItem = Extract<
  NotificationItem,
  { category: "monitor" }
>;

const SSL_CAUTION_DAY_MS = 24 * 60 * 60 * 1000;

function sslDaysRemainingAt(notAfter: string, occurredAt: string): number {
  const remainingMs =
    new Date(notAfter).getTime() - new Date(occurredAt).getTime();
  return Math.ceil(remainingMs / SSL_CAUTION_DAY_MS) + 0;
}

function itemTitle(item: NotificationItem) {
  if (item.scope === "organization") {
    switch (item.eventType) {
      case "ORG-NOTIFICATION-SETTINGS-CHANGED":
        return `การตั้งค่าการแจ้งเตือนเปลี่ยนโดย ${item.actor.displayName}`;
      case "MONITOR_DOWN":
        return `มอนิเตอร์ ${item.subject.monitorName} ล่ม`;
      case "MONITOR_RECOVERED":
        return `มอนิเตอร์ ${item.subject.monitorName} กลับมาทำงานแล้ว`;
      case "MONITOR_SSL_CAUTION": {
        const days = sslDaysRemainingAt(item.sslNotAfter, item.occurredAt);
        return `ใบรับรอง SSL ของ ${item.subject.monitorName} ใกล้หมดอายุ (เหลือไม่เกิน ${String(days)} วัน)`;
      }
      case "MONITOR_SSL_DANGER":
        return `ใบรับรอง SSL ของ ${item.subject.monitorName} ใกล้หมดอายุมาก (เหลือไม่เกิน 7 วัน)`;
      case "MONITOR_SSL_EXPIRED":
        return `ใบรับรอง SSL ของ ${item.subject.monitorName} หมดอายุแล้ว`;
      case "AUDIT_EXPORT_READY":
        return "ไฟล์ส่งออกบันทึกกิจกรรมพร้อมดาวน์โหลด";
      case "AUDIT_EXPORT_FAILED":
        return "สร้างไฟล์ส่งออกไม่สำเร็จ";
    }
  }
  if (item.eventType === "PASSWORD_CHANGED") return "มีการเปลี่ยนรหัสผ่าน";
  if (item.eventType === "MFA_ENABLED")
    return "เปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว";
  return "ปิดใช้การยืนยันตัวตนหลายปัจจัยแล้ว";
}
// Scope and category, rendered as two parts rather than one dotted string.
function itemContext(
  item: NotificationItem,
  organizationName = "องค์กร",
): [string, string] {
  if (item.scope !== "organization") return ["บัญชีของคุณ", "ความปลอดภัย"];
  if (item.category === "monitor") return [organizationName, "มอนิเตอร์"];
  if (item.category === "audit-log") return [organizationName, "บันทึกกิจกรรม"];
  return [organizationName, "การตั้งค่าการแจ้งเตือน"];
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
      case "AUDIT_EXPORT_READY":
        return <DownloadIcon size={size} />;
      case "AUDIT_EXPORT_FAILED":
        return <HistoryIcon size={size} />;
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
  return `/organizations/${item.organizationId}/projects/${item.subject.projectId}/monitors/${item.subject.monitorId}`;
}
/** Export results link to the section where the requester's files are listed. */
function auditExportPath(organizationId: string) {
  return `/organizations/${organizationId}/audit-log#my-exports`;
}
function MonitorFacts({
  item,
  preferences,
}: {
  item: MonitorNotificationItem;
  preferences: Preferences;
}) {
  if (item.eventType === "MONITOR_DOWN") {
    return (
      <span data-testid="notification-reason" data-reason={item.reason}>
        สาเหตุ: {downReason(item.reason)}
      </span>
    );
  }
  if (item.sslNotAfter === null) return null;
  return (
    <span>
      {item.eventType === "MONITOR_SSL_EXPIRED"
        ? "ใบรับรองหมดอายุเมื่อ "
        : "ใบรับรองหมดอายุ "}
      <time data-testid="notification-ssl-expiry" dateTime={item.sslNotAfter}>
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

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();
const dayDateFormatters = new Map<string, Intl.DateTimeFormat>();
function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const zone = options.timeZone ?? "";
  let formatter = cache.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    cache.set(zone, formatter);
  }
  return formatter;
}
function dayKey(value: string | Date, preferences: Preferences) {
  return cachedFormatter(dayKeyFormatters, "en-CA", {
    timeZone: preferences.timeZone,
  }).format(typeof value === "string" ? new Date(value) : value);
}
function dayDate(value: string, preferences: Preferences) {
  return cachedFormatter(dayDateFormatters, "th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: preferences.timeZone,
  }).format(new Date(value));
}
/** Yesterday's key from the local calendar date, so 23/25-hour DST days stay correct. */
function previousDayKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - 1))
    .toISOString()
    .slice(0, 10);
}
function dayLabel(value: string, preferences: Preferences) {
  const key = dayKey(value, preferences);
  const today = dayKey(new Date(), preferences);
  if (key === today) return "วันนี้";
  if (key === previousDayKey(today)) return "เมื่อวาน";
  return dayDate(value, preferences);
}

function NotificationList({
  items,
  onOpen,
  onNavigate,
  popoverItems,
}: {
  items: NotificationItem[];
  onOpen: (id: string) => void;
  onNavigate?: () => void;
  popoverItems: boolean;
}) {
  const { preferences } = usePreferences();
  const { me } = useTenant();
  return (
    <ul className="divide-y divide-foreground/10">
      {items.map((item) => {
        const unread = item.readAt === null;
        return (
          <li
            data-testid={`notification-row-${item.id}`}
            data-event-type={item.eventType}
            data-scope={item.scope}
            data-category={item.category}
            data-read-at={item.readAt ?? ""}
            key={item.id}
          >
            <button
              data-testid={`notification-open-${item.id}`}
              type="button"
              onClick={() => {
                onOpen(item.id);
              }}
              data-popover-item={popoverItems ? "" : undefined}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-100 hover:surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            >
              {unread ? (
                <span
                  data-testid="notification-unread"
                  aria-label="ยังไม่อ่าน"
                  role="img"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-foreground/20"
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-foreground-secondary"
                  >
                    <ItemIcon item={item} size={16} />
                  </span>
                  <span
                    data-testid="notification-title"
                    className={`text-sm ${unread ? "font-semibold text-heading" : ""}`}
                  >
                    {itemTitle(item)}
                  </span>
                </span>
                <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-foreground-secondary">
                  {itemContext(
                    item,
                    me?.organizations.find(
                      (org) => org.id === item.organizationId,
                    )?.name,
                  ).map((part) => (
                    <span key={part}>{part}</span>
                  ))}
                  {item.category === "monitor" &&
                  item.subject.monitorHostname !== null ? (
                    <span
                      className="font-mono"
                      data-testid="notification-monitor-hostname"
                    >
                      {item.subject.monitorHostname}
                    </span>
                  ) : null}
                  <time
                    dateTime={item.occurredAt}
                    title={itemTime(item.occurredAt, preferences)}
                    className="text-xs text-foreground"
                  >
                    {relativeTime(item.occurredAt, preferences)}
                  </time>
                </span>
                {item.scope === "organization" &&
                item.category === "monitor" ? (
                  <span className="text-xs text-foreground-secondary">
                    <MonitorFacts item={item} preferences={preferences} />
                  </span>
                ) : null}
              </span>
            </button>
            {item.scope === "organization" && item.category === "monitor" ? (
              <Link
                data-testid="notification-monitor-link"
                to={monitorPath(item)}
                onClick={onNavigate}
                data-popover-item={popoverItems ? "" : undefined}
                className="mb-3 ml-9 inline-block text-xs text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                เปิดมอนิเตอร์
                <span className="sr-only"> {item.subject.monitorName}</span>
              </Link>
            ) : null}
            {item.scope === "organization" && item.category === "audit-log" ? (
              <Link
                data-testid="notification-audit-link"
                to={auditExportPath(item.organizationId)}
                onClick={onNavigate}
                data-popover-item={popoverItems ? "" : undefined}
                className="mb-3 ml-9 inline-block text-xs text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                เปิดบันทึกกิจกรรม
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function NotificationRows({
  items,
  onOpen,
  onNavigate,
  popoverItems = false,
  groupByDay = false,
}: {
  items: NotificationItem[];
  onOpen: (id: string) => void;
  /** Called when a monitor link is followed (the popover closes itself). */
  onNavigate?: () => void;
  popoverItems?: boolean;
  /** Day headers (user time zone) for the inbox page; the popover stays flat. */
  groupByDay?: boolean;
}) {
  const { preferences } = usePreferences();
  if (!groupByDay) {
    return (
      <NotificationList
        items={items}
        onOpen={onOpen}
        onNavigate={onNavigate}
        popoverItems={popoverItems}
      />
    );
  }
  const groups: { key: string; first: string; items: NotificationItem[] }[] =
    [];
  for (const item of items) {
    const key = dayKey(item.occurredAt, preferences);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, first: item.occurredAt, items: [item] });
  }
  return (
    <div>
      {groups.map((group) => {
        const title = dayLabel(group.first, preferences);
        const date = dayDate(group.first, preferences);
        return (
          <section
            data-testid={`notification-day-${group.key}`}
            data-day-key={group.key}
            key={group.key}
            aria-labelledby={`inbox-day-${group.key}`}
          >
            <SectionHeader
              headingTestId="notification-day-title"
              id={`inbox-day-${group.key}`}
              title={title}
              meta={title === date ? undefined : <span>{date}</span>}
              className="px-4 pt-4"
            />
            <NotificationList
              items={group.items}
              onOpen={onOpen}
              onNavigate={onNavigate}
              popoverItems={popoverItems}
            />
          </section>
        );
      })}
    </div>
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
  const { me } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = normalizeNotificationFilters({
    status: searchParams.get("status"),
    category: searchParams.get("category"),
  });
  const location = useLocation();
  const focusTarget = (
    location.state as { notificationFilterFocus?: string } | null
  )?.notificationFilterFocus;
  const focusedFilter = useRef<HTMLButtonElement>(null);
  function changeFilters(update: Partial<typeof filters>, target: string) {
    const next = { ...filters, ...update };
    const params = new URLSearchParams(searchParams);
    if (next.status === "all") params.delete("status");
    else params.set("status", next.status);
    if (next.category === null) params.delete("category");
    else params.set("category", next.category);
    setSearchParams(params, { state: { notificationFilterFocus: target } });
  }
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
  const recoveredCursor = useRef(false);
  const [pagesReset, setPagesReset] = useState(false);
  const list = useQuery({
    queryKey: notificationFilteredQueryKey(serverActiveOrgId, filters),
    queryFn: () => fetchNotifications(serverActiveOrgId, filters),
    retry: false,
  });
  useEffect(() => {
    focusedFilter.current?.focus();
  }, [focusTarget, list.isSuccess]);
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
        queryKey: notificationPageQueryKey(
          serverActiveOrgId,
          nextCursor,
          filters,
        ),
        queryFn: () =>
          fetchNotifications(serverActiveOrgId, {
            ...filters,
            cursor: nextCursor,
          }),
        staleTime: Infinity,
        // A rejected cursor must reach recovery without replaying its chain.
        retry: false,
      });
      setRetained({ firstPage, pages: [...pages, nextPage] });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "INVALID_CURSOR" &&
        !recoveredCursor.current
      ) {
        recoveredCursor.current = true;
        setRetained(null);
        client.removeQueries({
          queryKey: notificationPagesQueryKey(serverActiveOrgId, filters),
        });
        setPagesReset(true);
        await list.refetch();
      } else {
        setNextPageError(error);
      }
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
        data-testid="notifications-back"
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
          <PageState
            data-testid="notification-detail-error"
            kind="error"
            message={problem(open.error)}
          />
        </Page>
      );
    }
    const detail = open.data;
    return (
      <Page>
        {backButton}
        <PageHeader
          scope={{
            label: itemContext(
              detail,
              me?.organizations.find((org) => org.id === detail.organizationId)
                ?.name,
            )[0],
            tag: itemContext(detail)[1],
          }}
          title={itemTitle(detail)}
        />
        <Card
          data-testid={`notification-detail-${detail.id}`}
          data-event-type={detail.eventType}
          as="article"
        >
          <dl className="grid gap-x-8 gap-y-1 p-6 text-sm sm:grid-cols-[max-content_1fr] sm:gap-y-4">
            <dt className="text-foreground-secondary">สถานะ</dt>
            <dd className="mb-3 sm:mb-0">
              <StatusPill
                data-testid={
                  detail.readAt === null
                    ? "notification-detail-unread"
                    : "notification-detail-read"
                }
                dot
              >
                {detail.readAt === null ? "ยังไม่อ่าน" : "อ่านแล้ว"}
              </StatusPill>
            </dd>
            <dt className="text-foreground-secondary">เวลาที่เกิดเหตุการณ์</dt>
            <dd className="mb-3 sm:mb-0">
              <time dateTime={detail.occurredAt}>
                {itemTime(detail.occurredAt, preferences)}
              </time>
            </dd>
            {detail.readAt === null ? null : (
              <>
                <dt className="text-foreground-secondary">อ่านเมื่อ</dt>
                <dd className="mb-3 sm:mb-0">
                  <time
                    data-testid="notification-detail-read-at"
                    dateTime={detail.readAt}
                  >
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
                    data-testid="notification-monitor-link"
                    to={monitorPath(detail)}
                    className="text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    เปิดมอนิเตอร์
                    <span className="sr-only">
                      {" "}
                      {detail.subject.monitorName}
                    </span>
                  </Link>{" "}
                  <span
                    data-testid="notification-monitor-name"
                    className="text-foreground-secondary"
                  >
                    ({detail.subject.monitorName})
                  </span>
                  {detail.subject.monitorHostname !== null ? (
                    <span
                      className="ml-2 font-mono"
                      data-testid="notification-monitor-hostname"
                    >
                      {detail.subject.monitorHostname}
                    </span>
                  ) : null}
                </dd>
                <dt className="text-foreground-secondary">รายละเอียด</dt>
                <dd>
                  <MonitorFacts item={detail} preferences={preferences} />
                </dd>
              </>
            ) : null}
            {detail.scope === "organization" &&
            detail.category === "audit-log" ? (
              <>
                <dt className="text-foreground-secondary">บันทึกกิจกรรม</dt>
                <dd className="mb-3 sm:mb-0">
                  <Link
                    to={auditExportPath(detail.organizationId)}
                    className="text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    เปิดบันทึกกิจกรรม
                  </Link>
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
        <PageHeader eyebrow="// inbox" scope={scope} title="การแจ้งเตือน" />
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
        <PageHeader eyebrow="// inbox" scope={scope} title="การแจ้งเตือน" />
        <PageState
          data-testid="notifications-list-error"
          retryTestId="notifications-list-retry"
          kind="error"
          message={problem(list.error)}
          retryLabel="ลองใหม่"
          onRetry={() => void list.refetch()}
        />
      </Page>
    );
  const { unreadCount, counts } = list.data;
  return (
    <Page>
      <PageHeader
        eyebrow="// inbox"
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
            data-testid="notifications-mark-all"
            variant="secondary"
            className="h-auto min-h-10 w-full max-w-full break-words whitespace-normal sm:w-auto"
            disabled={unreadCount === 0 || all.isPending}
            onClick={() => {
              all.mutate(serverActiveOrgId);
            }}
          >
            <CheckIcon size={16} />
            ทำเครื่องหมายว่าอ่านทั้งหมด
          </Button>
        }
      />
      {all.isError ? (
        <Alert data-testid="notifications-mark-all-error" tone="error">
          ทำเครื่องหมายว่าอ่านทั้งหมดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </Alert>
      ) : null}
      {all.isSuccess && unreadCount === 0 ? (
        <Notice data-testid="notifications-mark-all-success" tone="success">
          ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
        </Notice>
      ) : null}
      <div className="flex flex-col gap-3 text-sm text-foreground-secondary">
        <div
          role="tablist"
          aria-label="ตัวกรองการแจ้งเตือน"
          className="flex gap-4 border-b border-foreground/10"
        >
          {(["all", "unread"] as const).map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              id={`notifications-tab-${status}`}
              data-testid={`notifications-filter-status-${status}`}
              aria-selected={filters.status === status}
              aria-controls="notifications-items"
              ref={
                focusTarget === `status-${status}` ? focusedFilter : undefined
              }
              tabIndex={filters.status === status ? 0 : -1}
              className={`inline-flex min-h-10 items-center gap-2 border-b-2 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filters.status === status ? "border-primary text-heading" : "border-transparent"}`}
              onClick={() => {
                changeFilters({ status }, `status-${status}`);
              }}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "all"
                    : event.key === "End"
                      ? "unread"
                      : status === "all"
                        ? "unread"
                        : "all";
                changeFilters({ status: next }, `status-${next}`);
              }}
            >
              {status === "all" ? "ทั้งหมด" : "ยังไม่อ่าน"}{" "}
              <span className="font-mono">
                {status === "all" ? counts.total : counts.unread}
              </span>
            </button>
          ))}
        </div>
        <p data-testid="notifications-count-recent" className="text-xs">
          <span className="font-mono">{counts.recent}</span> รายการใน 7 วัน (ถึง{" "}
          {itemTime(counts.window.until, preferences)})
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "ทั้งหมด"],
              ["monitor", "มอนิเตอร์"],
              ["security", "ความปลอดภัย"],
              ["organization", "องค์กร"],
            ] as const
          ).map(([category, label]) => (
            <Button
              key={category}
              variant="secondary"
              className="aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
              data-testid={`notifications-filter-category-${category}`}
              aria-pressed={(filters.category ?? "all") === category}
              ref={
                focusTarget === `category-${category}`
                  ? focusedFilter
                  : undefined
              }
              onClick={() => {
                changeFilters(
                  {
                    category:
                      category === "all" || filters.category === category
                        ? null
                        : category,
                  },
                  `category-${category}`,
                );
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {pagesReset ? (
        <Notice data-testid="notifications-pages-reset" tone="pending">
          โหลดรายการใหม่แล้ว เนื่องจากหน้าถัดไปหมดอายุ
        </Notice>
      ) : null}
      <div
        id="notifications-items"
        role="tabpanel"
        aria-labelledby={`notifications-tab-${filters.status}`}
      >
        {items.length === 0 &&
        (filters.status !== "all" || filters.category !== null) ? (
          <EmptyState
            data-testid="notifications-no-match"
            icon={<BellIcon size={20} />}
            title="ไม่มีรายการที่ตรงกับตัวกรอง"
            action={
              <Button
                data-testid="notifications-no-match-clear"
                onClick={() => {
                  changeFilters(
                    { status: "all", category: null },
                    "status-all",
                  );
                }}
              >
                ล้างตัวกรอง
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            data-testid="notifications-empty"
            icon={<BellIcon size={20} />}
            title="ยังไม่มีการแจ้งเตือน"
            description="เหตุการณ์ด้านความปลอดภัยของบัญชี การเปลี่ยนแปลงขององค์กรและสถานะมอนิเตอร์จะแสดงที่นี่"
          />
        ) : (
          <Card className="overflow-hidden">
            <NotificationRows items={items} onOpen={requestOpen} groupByDay />
            {nextCursor === null ? null : (
              <div className="border-t border-foreground/10 p-2">
                {nextPageError === null ? null : (
                  <div className="mb-2">
                    <Alert data-testid="notifications-next-error" tone="error">
                      {problem(nextPageError)}
                    </Alert>
                  </div>
                )}
                <Button
                  data-testid="notifications-load-more"
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
