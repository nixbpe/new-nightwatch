import type {
  MonitorHealthName,
  MonitorListResponse,
} from "@nightwatch/api-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { EmptyState } from "../../components/shell/EmptyState";
import { ActivityIcon } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert, Input, textInputClass } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { DataTablePagination } from "../../components/ui/data-table";
import { Label } from "../../components/ui/label";
import { ApiError } from "../../lib/api/client";
import {
  fetchMonitorList,
  MONITOR_LIST_PAGE_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { useFlashNotice } from "./flash";
import { formatTimeWithSeconds, Time, TIME_ZONE } from "./format";
import { HEALTH_LABELS } from "./HealthPill";
import { MonitorTable } from "./MonitorTable";
import { RecentEventsCard } from "./RecentEventsCard";

const SEARCH_DEBOUNCE_MS = 300;
const SUMMARY_ORDER = ["up", "down", "unknown", "paused"] as const;

function isDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}

export function OverviewPage() {
  const { organizationId } = useParams();
  if (organizationId === undefined) return null;
  // Keyed so filters, page and announcements never carry over to another Organization.
  return (
    <OverviewForOrganization
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

function SummaryStrip({
  summary,
}: {
  summary: MonitorListResponse["summary"];
}) {
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {SUMMARY_ORDER.map((health) => (
        <div
          key={health}
          className="rounded-md border border-foreground/10 bg-surface p-4"
        >
          <dt className="text-sm text-foreground-secondary">
            {HEALTH_LABELS[health]}
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-heading tabular-nums">
            {summary[health]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OverviewLoading() {
  return (
    <>
      <div aria-hidden="true" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {SUMMARY_ORDER.map((health) => (
          <Skeleton key={health} className="h-20 w-full" />
        ))}
      </div>
      <PageState
        kind="loading"
        label="กำลังโหลดมอนิเตอร์"
        layout="table"
        visibleLabel
      />
      <Skeleton className="h-32 w-full" />
    </>
  );
}

function OverviewForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const isMember = organization !== undefined;

  const [offset, setOffset] = useState(0);
  const [health, setHealth] = useState<MonitorHealthName | undefined>();
  const [q, setQ] = useState("");
  const [searchText, setSearchText] = useState("");
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [contextRefresh, setContextRefresh] = useState<
    "idle" | "refreshing" | "done"
  >("idle");
  // Set by a filter change the user made; the announcement waits for that filter's own data.
  const pendingAnnouncement = useRef(false);

  const listParams = {
    limit: MONITOR_LIST_PAGE_SIZE,
    offset,
    health,
    q: q === "" ? undefined : q,
  };
  const list = useQuery({
    queryKey: monitorQueryKeys.list(organizationId, listParams),
    queryFn: () => fetchMonitorList(organizationId, listParams),
    enabled: isMember,
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
    // Safe across filters because the component is keyed by Organization.
    placeholderData: keepPreviousData,
  });
  const data = list.data;

  useEffect(() => {
    if (searchText.trim() === q) return;
    const timer = setTimeout(() => {
      pendingAnnouncement.current = true;
      setOffset(0);
      setQ(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchText, q]);

  // Only a filter change announces; the 30 s refetch leaves this state alone.
  useEffect(() => {
    if (!pendingAnnouncement.current || data === undefined) return;
    if (list.isPlaceholderData) return;
    pendingAnnouncement.current = false;
    setAnnouncement((previous) => ({
      text: `พบ ${String(data.page.total)} จาก ${String(data.summary.total)}`,
      count: previous.count + 1,
    }));
  }, [data, list.isPlaceholderData]);

  // A page past the end (rows deleted elsewhere) goes back to the first page.
  useEffect(() => {
    if (
      data !== undefined &&
      !list.isPlaceholderData &&
      offset > 0 &&
      data.monitors.length === 0
    ) {
      setOffset(0);
    }
  }, [data, list.isPlaceholderData, offset]);

  const denied = isDenied(list.error);
  useEffect(() => {
    if (!denied || contextRefresh !== "idle") return;
    setContextRefresh("refreshing");
    void refreshMembershipContext().finally(() => {
      setContextRefresh("done");
    });
  }, [denied, contextRefresh, refreshMembershipContext]);

  const { notice, heading } = useFlashNotice();

  const header = (actions?: ReactNode, status?: ReactNode) => (
    <>
      <PageHeader
        scope={
          organization === undefined
            ? undefined
            : {
                mark: organization.name,
                label: organization.name,
                tag: ROLE_LABELS[organization.role] ?? organization.role,
              }
        }
        title="ตรวจสถานะบริการ"
        status={status}
        actions={actions}
        titleRef={heading}
        titleTabIndex={-1}
      />
      {notice === null ? null : <Notice tone="success">{notice}</Notice>}
    </>
  );

  if (mePending || contextRefresh === "refreshing") {
    return (
      <Page>
        {header()}
        <OverviewLoading />
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
    // No scope row, name or count: a non-member learns nothing about this Organization.
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

  const canWrite =
    organization.role === "owner" || organization.role === "admin";
  const firstRun = data !== undefined && data.summary.total === 0;
  const limitReached =
    data !== undefined && data.summary.total >= data.summary.limit;
  const addPath = `/organizations/${organizationId}/monitors/new`;

  let actions: ReactNode;
  if (canWrite && data !== undefined && !firstRun) {
    actions = limitReached ? (
      <>
        <span
          id="monitor-limit-reason"
          className="text-xs text-foreground-secondary"
        >
          องค์กรนี้มีมอนิเตอร์ครบ {data.summary.limit} ตัวแล้ว
          ลบมอนิเตอร์เดิมก่อนจึงจะเพิ่มได้
        </span>
        <Button type="button" disabled aria-describedby="monitor-limit-reason">
          เพิ่มมอนิเตอร์
        </Button>
      </>
    ) : (
      <Button asChild>
        <Link to={addPath}>เพิ่มมอนิเตอร์</Link>
      </Button>
    );
  }
  const status = canWrite ? undefined : <span>สิทธิ์ของคุณ: ดูอย่างเดียว</span>;

  const clearFilters = () => {
    pendingAnnouncement.current = true;
    setSearchText("");
    setQ("");
    setHealth(undefined);
    setOffset(0);
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await list.refetch();
    } finally {
      setRefreshing(false);
    }
  };
  const filtered = q !== "" || health !== undefined;
  const filterControls = (
    <div className="flex flex-wrap items-end gap-4">
      <Label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm">
        ค้นหาชื่อหรือ URL
        <Input
          type="search"
          value={searchText}
          maxLength={200}
          onChange={(event) => {
            setSearchText(event.target.value);
          }}
        />
      </Label>
      <Label className="flex flex-col gap-2 text-sm">
        สถานะ
        <select
          className={textInputClass}
          value={health ?? ""}
          onChange={(event) => {
            pendingAnnouncement.current = true;
            setOffset(0);
            setHealth(
              event.target.value === ""
                ? undefined
                : (event.target.value as MonitorHealthName),
            );
          }}
        >
          <option value="">ทั้งหมด</option>
          {SUMMARY_ORDER.map((value) => (
            <option key={value} value={value}>
              {HEALTH_LABELS[value]}
            </option>
          ))}
        </select>
      </Label>
      {data === undefined ? null : (
        <p className="pb-2.5 text-sm text-foreground-secondary tabular-nums">
          พบ {data.page.total} จาก {data.summary.total}
        </p>
      )}
    </div>
  );

  if (data === undefined) {
    return (
      <Page>
        {header(actions, status)}
        {list.isError ? (
          <>
            {filterControls}
            <PageState
              kind="error"
              message="โหลดมอนิเตอร์ไม่สำเร็จ"
              retryLabel="ลองอีกครั้ง"
              onRetry={() => void list.refetch()}
              actions={
                filtered ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={clearFilters}
                  >
                    ล้างตัวกรอง
                  </Button>
                ) : undefined
              }
            />
          </>
        ) : (
          <OverviewLoading />
        )}
      </Page>
    );
  }

  if (firstRun) {
    return (
      <Page>
        {header(undefined, status)}
        <p className="text-xs text-foreground-secondary">
          มอนิเตอร์ทั้งหมด <span className="font-mono text-foreground">0</span>
        </p>
        <EmptyState
          variant="first-run"
          icon={<ActivityIcon size={20} />}
          title="ยังไม่มีมอนิเตอร์"
          description={
            canWrite
              ? "เพิ่มเว็บไซต์หรือ API เพื่อให้ NightWatch ตรวจสถานะเป็นระยะและแจ้งเมื่อล่มหรือ SSL ใกล้หมดอายุ"
              : "ผู้ดูแลหรือเจ้าขององค์กรเพิ่มได้"
          }
          action={
            canWrite ? (
              <Button asChild>
                <Link to={addPath}>เพิ่มมอนิเตอร์</Link>
              </Button>
            ) : undefined
          }
        />
      </Page>
    );
  }

  const { page } = data;
  const shownFrom = page.total === 0 ? 0 : page.offset + 1;
  const shownTo = page.offset + data.monitors.length;

  return (
    <Page>
      {header(actions, status)}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-foreground-secondary">
        <span>
          มอนิเตอร์ทั้งหมด{" "}
          <span className="font-mono text-foreground">
            {data.summary.total}
          </span>
        </span>
        <span>
          ข้อมูล ณ <Time iso={data.dataAsOf} format={formatTimeWithSeconds} /> (
          {TIME_ZONE})
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-disabled={refreshing}
          className={refreshing ? "opacity-60" : undefined}
          onClick={() => {
            if (!refreshing) void refresh();
          }}
        >
          {refreshing ? "กำลังรีเฟรช…" : "รีเฟรช"}
        </Button>
      </div>
      {list.isError ? (
        <Alert tone="warning">
          อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ{" "}
          <Time iso={data.dataAsOf} format={formatTimeWithSeconds} />
        </Alert>
      ) : null}
      <SummaryStrip summary={data.summary} />
      {filterControls}
      <p role="status" aria-label="ผลการกรอง" className="sr-only">
        <span key={announcement.count}>{announcement.text}</span>
      </p>
      {page.total === 0 && filtered ? (
        <EmptyState
          icon={<ActivityIcon size={20} />}
          title="ไม่พบมอนิเตอร์ที่ตรงกับตัวกรอง"
          action={
            <Button type="button" variant="secondary" onClick={clearFilters}>
              ล้างตัวกรอง
            </Button>
          }
        />
      ) : (
        <div aria-busy={list.isPlaceholderData}>
          <MonitorTable
            organizationId={organizationId}
            monitors={data.monitors}
          />
        </div>
      )}
      {page.total === 0 ? null : (
        <DataTablePagination
          ariaLabel="หน้ามอนิเตอร์"
          summary={
            <>
              แสดง {shownFrom}–{shownTo} จาก {page.total}
            </>
          }
          previousLabel="ก่อนหน้า"
          nextLabel="ถัดไป"
          hasPrevious={page.offset > 0}
          hasNext={page.offset + data.monitors.length < page.total}
          onPrevious={() => {
            setOffset(Math.max(0, page.offset - MONITOR_LIST_PAGE_SIZE));
          }}
          onNext={() => {
            setOffset(page.offset + MONITOR_LIST_PAGE_SIZE);
          }}
        />
      )}
      <RecentEventsCard organizationId={organizationId} />
    </Page>
  );
}
