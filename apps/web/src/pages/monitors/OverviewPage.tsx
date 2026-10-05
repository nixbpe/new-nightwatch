import { isDenied } from "../workspace/rows";
import {
  MONITOR_LIST_SORTS,
  type MonitorHealthName,
  type MonitorListResponse,
  type MonitorListSort,
} from "@nightwatch/api-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { EmptyState } from "../../components/shell/EmptyState";
import { ActivityIcon, SearchIcon } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert, Input, textInputClass } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { DataTablePagination } from "../../components/ui/data-table";
import { HairlineGrid } from "../../components/ui/hairline-grid";
import { STAT_TILE_CLASS, StatTile } from "../../components/ui/stat-tile";
import { Label } from "../../components/ui/label";
import { SegmentedControl } from "../../components/ui/segmented-control";
import {
  fetchMonitorList,
  MONITOR_LIST_PAGE_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import { ROLE_LABELS } from "../../lib/roles";
import { cn } from "../../lib/utils";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { useFlashNotice } from "./flash";
import { formatTimeWithSeconds, Time, TIME_ZONE } from "./format";
import { HEALTH_LABELS } from "./HealthPill";
import { MonitorCards } from "./list/MonitorCards";
import { MonitorTable } from "./MonitorTable";
import { RecentEventsCard } from "./RecentEventsCard";

const SEARCH_DEBOUNCE_MS = 300;
const SUMMARY_ORDER = ["up", "down", "unknown", "paused"] as const;
// Same dots as the Workspace tiles; "unknown" is hollow so it differs from "paused" without a status colour.
const SUMMARY_DOT: Record<(typeof SUMMARY_ORDER)[number], string> = {
  up: "bg-primary",
  down: "bg-danger",
  unknown: "border border-foreground-secondary",
  paused: "bg-foreground-secondary",
};
const VIEW_STORAGE_KEY = "nightwatch:monitors-view";
const VIEW_OPTIONS = [
  { value: "cards", label: "การ์ด" },
  { value: "table", label: "ตาราง" },
] as const;
const SORT_LABELS: Record<MonitorListSort, string> = {
  problems: "ปัญหาก่อน",
  name: "ชื่อ A-Z",
  uptime: "ความพร้อมใช้งานต่ำสุด",
  response_time: "ตอบกลับช้าสุด",
  newest: "เพิ่มล่าสุด",
};
type ViewMode = (typeof VIEW_OPTIONS)[number]["value"];

// Per-viewer convenience only; storage can be blocked, so every access is guarded.
function readView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "cards"
      ? "cards"
      : "table";
  } catch {
    return "table";
  }
}
function writeView(view: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
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
    <HairlineGrid as="dl" className="grid-cols-2 lg:grid-cols-4">
      {SUMMARY_ORDER.map((health) => (
        <div key={health} className={STAT_TILE_CLASS}>
          <StatTile
            term
            dot={SUMMARY_DOT[health]}
            label={HEALTH_LABELS[health]}
            value={summary[health]}
          />
        </div>
      ))}
    </HairlineGrid>
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
  // Page state only: never stored, so a new visit starts at "problems".
  const [sort, setSort] = useState<MonitorListSort>("problems");
  const [searchText, setSearchText] = useState("");
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<ViewMode>(readView);
  const [contextRefresh, setContextRefresh] = useState<
    "idle" | "refreshing" | "done"
  >("idle");
  // Set by a filter change the user made; the announcement waits for that filter's own data.
  const pendingAnnouncement = useRef(false);
  const pendingSortLabel = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const listParams = {
    limit: MONITOR_LIST_PAGE_SIZE,
    offset,
    health,
    q: q === "" ? undefined : q,
    // The default order sends no sort, so its key equals the loader and nav counts key.
    sort: sort === "problems" ? undefined : sort,
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
    const found = `พบ ${String(data.page.total)} จาก ${String(data.summary.total)}`;
    const sortLabel = pendingSortLabel.current;
    pendingSortLabel.current = null;
    setAnnouncement((previous) => ({
      text: sortLabel === null ? found : `เรียงตาม ${sortLabel} · ${found}`,
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
        eyebrow="// monitors registry"
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
  const viewToggle = (
    <SegmentedControl
      label="รูปแบบการแสดงผล"
      value={view}
      options={VIEW_OPTIONS}
      onChange={(next) => {
        setView(next);
        writeView(next);
      }}
    />
  );

  const sortControl = (
    <Label className="flex w-fit max-w-full flex-col gap-2 text-sm">
      เรียงตาม
      <select
        className={textInputClass}
        value={sort}
        onChange={(event) => {
          const next = MONITOR_LIST_SORTS.find(
            (value) => value === event.target.value,
          );
          if (next === undefined) return;
          pendingAnnouncement.current = true;
          pendingSortLabel.current = SORT_LABELS[next];
          setOffset(0);
          setSort(next);
        }}
      >
        {MONITOR_LIST_SORTS.map((value) => (
          <option key={value} value={value}>
            {SORT_LABELS[value]}
          </option>
        ))}
      </select>
    </Label>
  );

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
  const statusChips: {
    value: MonitorHealthName | undefined;
    label: string;
    count?: number;
  }[] = [
    { value: undefined, label: "ทั้งหมด", count: data?.summary.total },
    ...SUMMARY_ORDER.map((value) => ({
      value,
      label: HEALTH_LABELS[value],
      count: data?.summary[value],
    })),
  ];
  const filterControls = (showClear: boolean, trailing?: ReactNode) => (
    <div className="flex flex-col gap-3">
      <Label className="flex flex-col gap-2 text-sm">
        <span className="sr-only">ค้นหาชื่อหรือ URL</span>
        <span className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-foreground-secondary"
          >
            <SearchIcon size={18} />
          </span>
          <Input
            type="search"
            ref={searchRef}
            value={searchText}
            maxLength={200}
            className="pl-10"
            placeholder="ค้นหาชื่อหรือ URL"
            onChange={(event) => {
              setSearchText(event.target.value);
            }}
          />
        </span>
      </Label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-foreground-secondary">สถานะ</span>
        <div
          role="group"
          aria-label="สถานะ"
          className="flex flex-1 flex-wrap gap-2"
        >
          {statusChips.map((chip) => {
            const pressed = chip.value === health;
            return (
              <button
                key={chip.value ?? "all"}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  pendingAnnouncement.current = true;
                  setOffset(0);
                  setHealth(chip.value);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  pressed
                    ? "border-primary bg-primary-tint text-primary"
                    : "border-control-border bg-surface text-foreground hover:surface-hover",
                )}
              >
                {chip.label}
                {chip.count === undefined ? null : (
                  <span aria-hidden="true" className="font-mono text-xs">
                    {chip.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {showClear && filtered ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              clearFilters();
              // The button unmounts once the filter is clear; keep focus on a stable control.
              searchRef.current?.focus();
            }}
          >
            ล้างตัวกรอง
          </Button>
        ) : null}
      </div>
      {data === undefined ? null : (
        <p className="text-xs text-foreground-secondary tabular-nums">
          พบ {data.page.total} จาก {data.summary.total}
        </p>
      )}
      {trailing}
    </div>
  );

  if (data === undefined) {
    return (
      <Page>
        {header(actions, status)}
        {list.isError ? (
          <>
            {filterControls(false)}
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
      {header(
        <>
          {actions}
          <Button
            type="button"
            variant="secondary"
            aria-disabled={refreshing}
            className={refreshing ? "opacity-60" : undefined}
            onClick={() => {
              if (!refreshing) void refresh();
            }}
          >
            {refreshing ? "กำลังรีเฟรช…" : "รีเฟรช"}
          </Button>
          {viewToggle}
        </>,
        <>
          {status}
          <span>
            มอนิเตอร์ทั้งหมด{" "}
            <span className="font-mono">{data.summary.total}</span>
          </span>
          <span>
            ล่ม <span className="font-mono">{data.summary.down}</span>
          </span>
          <span>
            ข้อมูล ณ{" "}
            <span className="font-mono">
              <Time iso={data.dataAsOf} format={formatTimeWithSeconds} />
            </span>{" "}
            ({TIME_ZONE})
          </span>
        </>,
      )}
      {list.isError ? (
        <Alert tone="warning">
          อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ{" "}
          <Time iso={data.dataAsOf} format={formatTimeWithSeconds} />
        </Alert>
      ) : null}
      <SummaryStrip summary={data.summary} />
      {filterControls(!(page.total === 0 && filtered), sortControl)}
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
          {view === "cards" ? (
            <MonitorCards
              organizationId={organizationId}
              monitors={data.monitors}
            />
          ) : (
            <MonitorTable
              organizationId={organizationId}
              monitors={data.monitors}
            />
          )}
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
