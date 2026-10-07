import type { MonitorChecksResponse } from "@nightwatch/api-contract";
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type Query,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { ArrowLeftIcon } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/ui/data-table";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { ApiError } from "../../lib/api/client";
import {
  fetchMonitorChecks,
  fetchMonitorDetail,
  MONITOR_CHECKS_CHUNK_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import {
  AssertionTable,
  assertionRowFromResult,
} from "./detail/AssertionTable";
import { assertionSummary, failureText, OUTCOME_LABELS } from "./detail/labels";
import { formatDateTime, formatNumber, Time, TIME_ZONE } from "./format";
import { useLeaveOnOrganizationSwitch } from "./useLeaveOnOrganizationSwitch";
import { isDenied } from "../workspace/rows";

type Check = MonitorChecksResponse["checks"][number];
type UrlChange = MonitorChecksResponse["urlChanges"][number];
type Row = { check: Check; urlChanged: boolean };
type ChecksKey = ReturnType<typeof monitorQueryKeys.checksHistory>;
type ChecksQuery = UseInfiniteQueryResult<InfiniteData<MonitorChecksResponse>>;

// Same outline as the page titles of the audit log (AuditLogPage.tsx).
const TITLE_FOCUS_CLASS =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const OUTCOME_TONES = {
  pass: "neutral",
  fail: "danger",
  check_error: "muted",
} as const;

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "MONITOR_NOT_FOUND";
}

/**
 * A URL change is marked on the first result at or after it. The oldest row
 * has no older neighbour here, so the list of changes above the table is what
 * covers a change older than every loaded row.
 */
function markUrlChanges(checks: Check[], urlChanges: UrlChange[]): Row[] {
  return checks.map((check, index) => {
    const older = checks[index + 1];
    const at = new Date(check.checkedAt).getTime();
    const olderAt =
      older === undefined ? null : new Date(older.checkedAt).getTime();
    return {
      check,
      urlChanged: urlChanges.some((change) => {
        const changedAt = new Date(change.at).getTime();
        return changedAt <= at && olderAt !== null && changedAt > olderAt;
      }),
    };
  });
}

/**
 * Chunks are read at a moving offset, so results that arrive after the first
 * chunk push rows down and shift what the next chunk holds. The first chunk is
 * taken whole. A later chunk adds only rows strictly older than the last row
 * accumulated: that drops the rows it repeats and, when more results arrived
 * than rows are loaded, the rows newer than the first chunk, so the order stays
 * newest first (`scheduledFor` is the primary key of a result). A later chunk
 * adds only URL changes not newer than the newest row loaded.
 */
function accumulate(pages: MonitorChecksResponse[]) {
  const changed = new Set<string>();
  const checks: Check[] = [];
  const urlChanges: UrlChange[] = [];
  pages.forEach((page, index) => {
    const newest = checks[0];
    const newestAt =
      newest === undefined ? Infinity : Date.parse(newest.scheduledFor);
    for (const check of page.checks) {
      const last = checks.at(-1);
      if (
        index > 0 &&
        last !== undefined &&
        Date.parse(check.scheduledFor) >= Date.parse(last.scheduledFor)
      ) {
        continue;
      }
      checks.push(check);
    }
    for (const change of page.urlChanges) {
      if (index > 0 && Date.parse(change.at) > newestAt) continue;
      const key = `${change.at} ${change.url}`;
      if (changed.has(key)) continue;
      changed.add(key);
      urlChanges.push(change);
    }
  });
  return { checks, urlChanges };
}

/**
 * Only the first chunk refreshes on its own: refetching every loaded chunk
 * would shift rows under the reader. A refusal ends it, and so does a failed
 * load more, whose Alert stays until the next press.
 */
function refreshesAutomatically(
  query: Query<
    MonitorChecksResponse,
    Error,
    InfiniteData<MonitorChecksResponse, number>,
    ChecksKey
  >,
): boolean {
  const { data, error, status, fetchMeta } = query.state;
  if (isNotFound(error) || isDenied(error)) return false;
  if (status === "error" && fetchMeta?.fetchMore !== undefined) return false;
  return data?.pages.length === 1;
}

const columns: DataTableColumn<Row>[] = [
  {
    key: "time",
    header: `เวลา (${TIME_ZONE})`,
    cell: ({ check, urlChanged }) => (
      <span className="flex flex-col py-1.5">
        <Time iso={check.checkedAt} format={formatDateTime} />
        {urlChanged ? (
          <span className="mt-1 flex flex-col items-start gap-1">
            <StatusPill tone="caution">เปลี่ยน URL</StatusPill>
            <span className="font-mono text-xs break-all text-foreground-secondary">
              {check.url}
            </span>
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "outcome",
    header: "ผล",
    cell: ({ check }) => (
      <StatusPill tone={OUTCOME_TONES[check.outcome]} dot>
        {OUTCOME_LABELS[check.outcome]}
      </StatusPill>
    ),
  },
  {
    key: "http",
    header: "HTTP",
    mono: true,
    cell: ({ check }) => check.httpStatus ?? "–",
  },
  {
    key: "response",
    header: "ตอบสนอง",
    align: "end",
    cell: ({ check }) =>
      check.responseTimeMs === null ? (
        "–"
      ) : (
        <span className="tabular-nums">
          {formatNumber(check.responseTimeMs)} ms
        </span>
      ),
  },
  {
    key: "assertions",
    header: "Assertions",
    cell: ({ check }) => {
      const summary = assertionSummary(check.assertions);
      if (summary === null) return "–";
      return (
        <details>
          <summary className="cursor-pointer">{summary}</summary>
          <div className="mt-2">
            <AssertionTable
              caption={`Assertions ของผลตรวจ ${formatDateTime(check.checkedAt)}`}
              rows={check.assertions.map((item, index) =>
                assertionRowFromResult(item, index),
              )}
            />
          </div>
        </details>
      );
    },
  },
  {
    key: "reason",
    header: "สาเหตุ",
    cell: ({ check }) => failureText(check) ?? "–",
  },
];

export function ChecksHistoryPage() {
  const { organizationId, monitorId } = useParams();
  if (organizationId === undefined || monitorId === undefined) return null;
  // Keyed so nothing carries over to another Organization or monitor.
  return (
    <ChecksHistoryForMonitor
      key={`${organizationId}:${monitorId}`}
      organizationId={organizationId}
      monitorId={monitorId}
    />
  );
}

function ChecksHistoryForMonitor({
  organizationId,
  monitorId,
}: {
  organizationId: string;
  monitorId: string;
}) {
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const switchedOrganization = useLeaveOnOrganizationSwitch(organizationId);
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const isMember = organization !== undefined;
  const overviewPath = `/organizations/${organizationId}/monitors`;

  // While the membership is re-read after a refusal, the page shows loading, never "denied" for a member who can still read.
  const [refreshing, setRefreshing] = useState(false);
  const [readRefresh, setReadRefresh] = useState<"idle" | "started">("idle");

  // Name and not-found/denied only: it is not refetched here.
  const detail = useQuery({
    queryKey: monitorQueryKeys.detail(organizationId, monitorId),
    queryFn: () => fetchMonitorDetail(organizationId, monitorId),
    enabled: isMember && !switchedOrganization,
  });
  const detailGone = isNotFound(detail.error) || isDenied(detail.error);

  const checks = useInfiniteQuery({
    queryKey: monitorQueryKeys.checksHistory(organizationId, monitorId),
    queryFn: ({ pageParam }) =>
      fetchMonitorChecks(organizationId, monitorId, {
        limit: MONITOR_CHECKS_CHUNK_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    // An empty chunk ends the list even when `total` says there is more.
    getNextPageParam: (last) => {
      const next = last.page.offset + last.checks.length;
      return last.checks.length > 0 && next < last.page.total
        ? next
        : undefined;
    },
    enabled: isMember && !switchedOrganization && !detailGone,
    staleTime: (query) =>
      (query.state.data?.pages.length ?? 0) > 1 ? Infinity : 0,
    // Chunks are dropped on leaving the page, so it always reopens on the first chunk.
    gcTime: 0,
    refetchInterval: (query) =>
      refreshesAutomatically(query) ? MONITOR_REFETCH_INTERVAL_MS : false,
    refetchOnWindowFocus: refreshesAutomatically,
    refetchOnReconnect: refreshesAutomatically,
  });

  const notFound = isNotFound(detail.error) || isNotFound(checks.error);
  const denied = isDenied(detail.error) || isDenied(checks.error);
  useEffect(() => {
    if (!denied || readRefresh !== "idle") return;
    setReadRefresh("started");
    setRefreshing(true);
    void refreshMembershipContext().finally(() => {
      setRefreshing(false);
    });
  }, [denied, readRefresh, refreshMembershipContext]);
  const monitor = notFound || denied ? undefined : detail.data?.monitor;

  const header = (title: ReactNode = "มอนิเตอร์") => (
    <>
      <Link
        to={`${overviewPath}/${monitorId}`}
        className="inline-flex min-h-6 items-center gap-1.5 self-start text-xs text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeftIcon size={14} />
        กลับไปหน้ามอนิเตอร์
      </Link>
      <PageHeader
        scope={
          organization === undefined || denied
            ? undefined
            : {
                mark: organization.name,
                label: organization.name,
                tag: ROLE_LABELS[organization.role] ?? organization.role,
              }
        }
        title={title}
      />
    </>
  );

  if (
    mePending ||
    switchedOrganization ||
    refreshing ||
    (denied && readRefresh === "idle")
  ) {
    return (
      <Page>
        {header()}
        <PageState kind="loading" label="กำลังโหลดมอนิเตอร์" layout="lines" />
        <Skeleton className="h-40 w-full" />
      </Page>
    );
  }
  if (meError !== null) {
    return (
      <Page>
        {header()}
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูมอนิเตอร์ได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshMembershipContext()}
        />
      </Page>
    );
  }
  if (organization === undefined || denied) {
    // No name or scope row: a non-member learns nothing about this Organization.
    return (
      <Page>
        {header()}
        <PageState
          kind="denied"
          message="คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"
        />
      </Page>
    );
  }
  if (notFound) {
    return (
      <Page>
        {header()}
        <PageState
          kind="denied"
          tone="info"
          message="ไม่พบมอนิเตอร์นี้"
          action={
            <Button asChild variant="secondary">
              <Link to={overviewPath}>กลับไปรายการมอนิเตอร์</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      {header(monitor?.name)}
      <ChecksHistorySection checks={checks} />
    </Page>
  );
}

function ChecksHistorySection({ checks }: { checks: ChecksQuery }) {
  const data = checks.data;
  const accumulated = useMemo(
    () => (data === undefined ? null : accumulate(data.pages)),
    [data],
  );
  const rows = useMemo(
    () =>
      accumulated === null
        ? []
        : markUrlChanges(accumulated.checks, accumulated.urlChanges),
    [accumulated],
  );
  const shown = rows.length;
  const total = data?.pages.at(-1)?.page.total ?? 0;
  const hasNext = checks.hasNextPage;

  const [announcement, setAnnouncement] = useState("");
  const [focusSummary, setFocusSummary] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const pressed = useRef(false);

  // The final load removes the button: its focus moves to the summary once the summary shows the final count.
  useEffect(() => {
    if (!focusSummary || hasNext) return;
    setFocusSummary(false);
    summary.current?.focus();
  }, [focusSummary, hasNext]);

  async function loadMore() {
    if (pressed.current || checks.isFetchingNextPage) return;
    pressed.current = true;
    const before = shown;
    setAnnouncement("");
    try {
      const result = await checks.fetchNextPage();
      if (result.isError || result.data === undefined) return;
      const now = accumulate(result.data.pages).checks.length;
      const added = now - before;
      if (!result.hasNextPage && document.activeElement === button.current) {
        // The summary takes focus instead of a live region, which would read the count twice.
        setFocusSummary(true);
        return;
      }
      const latest = result.data.pages.at(-1)?.page.total ?? 0;
      // With k = 0 the range would read "51–50", which names no row.
      setAnnouncement(
        added === 0
          ? "โหลดเพิ่ม 0 แถว"
          : `โหลดเพิ่ม ${String(added)} แถว (แถวที่ ${String(now - added + 1)}–${String(now)} จาก ${String(latest)})`,
      );
    } finally {
      pressed.current = false;
    }
  }

  const loadingMore = checks.isFetchingNextPage;
  const loadMoreFailed = checks.isFetchNextPageError && !loadingMore;
  const refetchFailed = checks.isError && !checks.isFetchNextPageError;

  return (
    <section aria-labelledby="checks-history" className="flex flex-col gap-4">
      <SectionHeader id="checks-history" title="ประวัติการตรวจ" />
      <div className="flex flex-col gap-3">
        {data === undefined && checks.isError ? (
          <>
            <Alert tone="error">โหลดประวัติการตรวจไม่สำเร็จ</Alert>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void checks.refetch()}
            >
              ลองอีกครั้ง
            </Button>
          </>
        ) : null}
        {data === undefined && !checks.isError ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <p role="status" className="sr-only">
              กำลังโหลดประวัติการตรวจ
            </p>
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        ) : null}
        {accumulated !== null && shown === 0 ? (
          <p className="text-sm text-foreground-secondary">ยังไม่มีผลการตรวจ</p>
        ) : null}
        {accumulated !== null && shown > 0 ? (
          <>
            {accumulated.urlChanges.length === 0 ? null : (
              <ul className="flex flex-col gap-1 text-xs text-foreground-secondary">
                {accumulated.urlChanges.map((change) => (
                  <li key={`${change.at} ${change.url}`}>
                    เปลี่ยน URL เมื่อ{" "}
                    <Time iso={change.at} format={formatDateTime} /> (
                    {TIME_ZONE}) เป็น{" "}
                    <span className="font-mono break-all">{change.url}</span>
                  </li>
                ))}
              </ul>
            )}
            <DataTable
              ariaLabel="ตารางประวัติการตรวจ"
              className="max-h-none"
              columns={columns}
              rows={rows}
              rowKey={({ check }) => check.scheduledFor}
            />
            {loadMoreFailed ? (
              <Alert tone="error">โหลดประวัติการตรวจไม่สำเร็จ</Alert>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p
                ref={summary}
                tabIndex={-1}
                className={`flex w-fit flex-col gap-1 rounded-[4px] text-xs text-foreground-secondary tabular-nums ${TITLE_FOCUS_CLASS}`}
              >
                <span>
                  {!hasNext && shown >= total
                    ? `แสดงครบ ${String(shown)} รายการ`
                    : `แสดง 1–${String(shown)} จาก ${String(total)}`}
                </span>
                {!hasNext && shown < total ? (
                  <span>
                    ผลตรวจที่ใหม่กว่าการโหลดครั้งแรกจะแสดงเมื่อเปิดหน้านี้ใหม่
                  </span>
                ) : null}
              </p>
              {hasNext ? (
                <Button
                  ref={button}
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-disabled={loadingMore}
                  className={loadingMore ? "opacity-60" : undefined}
                  onClick={() => {
                    void loadMore();
                  }}
                >
                  โหลดเพิ่ม
                </Button>
              ) : null}
            </div>
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </>
        ) : null}
        {accumulated !== null && refetchFailed ? (
          <Alert tone="warning">อัปเดตประวัติการตรวจไม่สำเร็จ</Alert>
        ) : null}
      </div>
    </section>
  );
}
