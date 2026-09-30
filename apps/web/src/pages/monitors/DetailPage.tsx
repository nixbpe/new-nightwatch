import type { Monitor, MonitorListResponse } from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ArrowLeftIcon } from "../../components/shell/icons";
import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Notice } from "../../components/ui/notice";
import { ApiError } from "../../lib/api/client";
import {
  deleteMonitor,
  fetchMonitorDetail,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
  type MonitorRecentEventsResponse,
  pauseMonitor,
  resumeMonitor,
} from "../../lib/api/monitors";
import { ROLE_LABELS } from "../../lib/roles";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { ChecksHistoryCard } from "./detail/ChecksHistoryCard";
import { ConfigCard } from "./detail/ConfigCard";
import { IncidentsCard } from "./detail/IncidentsCard";
import { intervalText } from "./detail/labels";
import { LastResultCard } from "./detail/LastResultCard";
import { ResponseTimeCard } from "./detail/ResponseTimeCard";
import { SslCard } from "./detail/SslCard";
import { StatusCard, statusLine } from "./detail/StatusCard";
import { useFlashNotice, type MonitorFlashState } from "./flash";
import { formatTimeOrDate, formatTimeWithSeconds, Time } from "./format";
import { HealthPill } from "./HealthPill";
import { useLeaveOnOrganizationSwitch } from "./useLeaveOnOrganizationSwitch";

const ROLE_CHANGED = "สิทธิ์ของคุณเปลี่ยนแล้ว";

function isDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "MONITOR_NOT_FOUND";
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PERMISSION_DENIED";
}

export function DetailPage() {
  const { organizationId, monitorId } = useParams();
  if (organizationId === undefined || monitorId === undefined) return null;
  // Keyed so nothing carries over to another Organization or monitor.
  return (
    <DetailForMonitor
      key={`${organizationId}:${monitorId}`}
      organizationId={organizationId}
      monitorId={monitorId}
    />
  );
}

function DetailLoading() {
  return (
    <>
      <PageState kind="loading" label="กำลังโหลดมอนิเตอร์" layout="lines" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </>
  );
}

function StateAlerts({ monitor }: { monitor: Monitor }) {
  return (
    <>
      {monitor.health === "paused" ? (
        <Alert tone="info" role="status">
          มอนิเตอร์นี้หยุดตรวจอยู่ จะไม่มีการแจ้งเตือน
        </Alert>
      ) : null}
      {monitor.health === "unknown" && monitor.healthReason === "stale" ? (
        <Alert tone="warning" role="status">
          ยังไม่มีผลตรวจใหม่ ข้อมูลอาจไม่ตรงกับสถานะปัจจุบัน
        </Alert>
      ) : null}
      {monitor.healthReason === "awaiting_new_config" ? (
        <Alert tone="info" role="status">
          แก้ไขเมื่อ <Time iso={monitor.updatedAt} format={formatTimeOrDate} />{" "}
          รอผลตรวจตามค่าใหม่
          {monitor.lastKnownDown ? " ล่าสุดทราบว่าล่ม" : null}
        </Alert>
      ) : null}
    </>
  );
}

function DetailForMonitor({
  organizationId,
  monitorId,
}: {
  organizationId: string;
  monitorId: string;
}) {
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notice: flashNotice, heading } = useFlashNotice();
  const switchedOrganization = useLeaveOnOrganizationSwitch(organizationId);
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const isMember = organization !== undefined;
  const overviewPath = `/organizations/${organizationId}/monitors`;

  // While the membership is re-read after a refusal, the page shows loading, never "denied" for a member who can still read.
  const [refreshing, setRefreshing] = useState(false);
  const [readRefresh, setReadRefresh] = useState<"idle" | "started">("idle");
  const refreshContext = () => {
    setRefreshing(true);
    void refreshMembershipContext().finally(() => {
      setRefreshing(false);
    });
  };

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    opener: HTMLElement;
  } | null>(null);

  const detail = useQuery({
    queryKey: monitorQueryKeys.detail(organizationId, monitorId),
    queryFn: () => fetchMonitorDetail(organizationId, monitorId),
    enabled: isMember && !switchedOrganization,
    refetchInterval: (query) =>
      isNotFound(query.state.error) || isDenied(query.state.error)
        ? false
        : MONITOR_REFETCH_INTERVAL_MS,
  });

  const notFound = isNotFound(detail.error);
  const denied = isDenied(detail.error);
  useEffect(() => {
    if (!denied || readRefresh !== "idle") return;
    setReadRefresh("started");
    setRefreshing(true);
    void refreshMembershipContext().finally(() => {
      setRefreshing(false);
    });
  }, [denied, readRefresh, refreshMembershipContext]);
  const monitor = notFound || denied ? undefined : detail.data?.monitor;

  const invalidateAll = (refetchType: "active" | "none" = "active") =>
    queryClient.invalidateQueries({
      queryKey: monitorQueryKeys.all(organizationId),
      refetchType,
    });

  // The Overview mounts with its cached list; without this it would show the deleted monitor until its refetch lands.
  function dropFromCachedLists() {
    queryClient.setQueriesData<MonitorListResponse>(
      {
        queryKey: monitorQueryKeys.all(organizationId),
        predicate: (query) => query.queryKey[3] === "list",
      },
      (cached) => {
        const gone = cached?.monitors.find((item) => item.id === monitorId);
        if (cached === undefined || gone === undefined) return cached;
        return {
          ...cached,
          summary: {
            ...cached.summary,
            [gone.health]: Math.max(0, cached.summary[gone.health] - 1),
            total: Math.max(0, cached.summary.total - 1),
          },
          monitors: cached.monitors.filter((item) => item.id !== monitorId),
          page: { ...cached.page, total: Math.max(0, cached.page.total - 1) },
        };
      },
    );
    queryClient.setQueriesData<MonitorRecentEventsResponse>(
      {
        queryKey: monitorQueryKeys.all(organizationId),
        predicate: (query) => query.queryKey[3] === "recent-events",
      },
      (cached) =>
        cached === undefined
          ? cached
          : {
              events: cached.events.filter(
                (event) => event.monitorId !== monitorId,
              ),
            },
    );
  }

  function handleWriteError(error: unknown, failure: string) {
    if (isPermissionDenied(error)) {
      setActionError(ROLE_CHANGED);
      refreshContext();
    } else if (isNotFound(error)) {
      // Deleted elsewhere: the refetch turns the page into the "not found" state.
      setActionError(null);
      void invalidateAll();
    } else {
      setActionError(failure);
      if (isDenied(error)) refreshContext();
    }
  }

  const toggle = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      action === "pause"
        ? pauseMonitor(organizationId, monitorId)
        : resumeMonitor(organizationId, monitorId),
    onMutate: () => {
      setNotice(null);
      setActionError(null);
    },
    // Awaiting the refetch keeps the button pending until the new state is shown.
    onSuccess: async (_record, action) => {
      await invalidateAll();
      setNotice(action === "pause" ? "หยุดการตรวจแล้ว" : "เริ่มการตรวจต่อแล้ว");
    },
    onError: (error, action) => {
      handleWriteError(
        error,
        action === "pause"
          ? "หยุดการตรวจไม่สำเร็จ ลองอีกครั้ง"
          : "เริ่มการตรวจต่อไม่สำเร็จ ลองอีกครั้ง",
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteMonitor(organizationId, monitorId),
    onMutate: () => {
      setNotice(null);
      setActionError(null);
    },
    onSuccess: async () => {
      dropFromCachedLists();
      // Not refetched: the monitor is gone, and this page is about to unmount.
      await invalidateAll("none");
      void navigate(overviewPath, {
        state: { notice: "deleted" } satisfies MonitorFlashState,
      });
    },
    onError: async (error) => {
      if (isNotFound(error)) {
        dropFromCachedLists();
        await invalidateAll("none");
        void navigate(overviewPath, {
          state: { notice: "alreadyDeleted" } satisfies MonitorFlashState,
        });
        return;
      }
      setDeleteDialog(null);
      handleWriteError(error, "ลบมอนิเตอร์ไม่สำเร็จ ลองอีกครั้ง");
    },
  });

  const header = (
    actions?: ReactNode,
    status?: ReactNode,
    title: ReactNode = "มอนิเตอร์",
  ) => (
    <>
      <Link
        to={overviewPath}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon size={14} />
        กลับไปรายการมอนิเตอร์
      </Link>
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
        title={title}
        status={status}
        actions={actions}
        titleRef={heading}
        titleTabIndex={-1}
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
        {actionError === null ? null : (
          <Alert tone="error">{actionError}</Alert>
        )}
        <DetailLoading />
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
  if (monitor === undefined) {
    return (
      <Page>
        {header()}
        {detail.isError ? (
          <PageState
            kind="error"
            message="โหลดมอนิเตอร์ไม่สำเร็จ"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <DetailLoading />
        )}
      </Page>
    );
  }

  const canWrite =
    organization.role === "owner" || organization.role === "admin";
  const paused = monitor.status === "paused";
  const busy = toggle.isPending;
  const actions = canWrite ? (
    <>
      <Button asChild variant="secondary">
        <Link to={`${overviewPath}/${monitorId}/edit`}>แก้ไข</Link>
      </Button>
      <Button
        type="button"
        variant="secondary"
        aria-disabled={busy}
        className={busy ? "opacity-60" : undefined}
        onClick={() => {
          if (!busy) toggle.mutate(paused ? "resume" : "pause");
        }}
      >
        {busy
          ? paused
            ? "กำลังเริ่มต่อ…"
            : "กำลังหยุด…"
          : paused
            ? "เริ่มต่อ"
            : "หยุดชั่วคราว"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={(event) => {
          setDeleteDialog({ opener: event.currentTarget });
        }}
      >
        ลบมอนิเตอร์
      </Button>
    </>
  ) : undefined;
  const line = statusLine(monitor);
  const status = (
    <>
      <HealthPill health={monitor.health} />
      {line === null ? null : <span>{line}</span>}
      <span className="font-mono break-all">{monitor.url}</span>
      <span>{intervalText(monitor.intervalSeconds)}</span>
      {canWrite ? null : <span>สิทธิ์ของคุณ: ดูอย่างเดียว</span>}
    </>
  );
  const shownNotice = notice ?? flashNotice;

  return (
    <Page>
      {header(actions, status, monitor.name)}
      {shownNotice === null ? null : (
        <Notice tone="success">{shownNotice}</Notice>
      )}
      {busy ? (
        <Notice tone="pending">
          {paused ? "กำลังเริ่มการตรวจต่อ" : "กำลังหยุดการตรวจ"}
        </Notice>
      ) : null}
      {actionError === null ? null : <Alert tone="error">{actionError}</Alert>}
      {detail.isError ? (
        <Alert tone="warning">
          อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ{" "}
          <Time iso={monitor.dataAsOf} format={formatTimeWithSeconds} />
        </Alert>
      ) : null}
      <StateAlerts monitor={monitor} />
      <StatusCard monitor={monitor} />
      <LastResultCard monitor={monitor} />
      <ResponseTimeCard
        organizationId={organizationId}
        monitorId={monitorId}
        lastCheckAt={monitor.lastCheckAt}
        dataAsOf={monitor.dataAsOf}
        intervalSeconds={monitor.intervalSeconds}
        createdAt={monitor.createdAt}
      />
      <SslCard ssl={monitor.ssl} />
      <IncidentsCard organizationId={organizationId} monitorId={monitorId} />
      <ChecksHistoryCard
        organizationId={organizationId}
        monitorId={monitorId}
      />
      <ConfigCard monitor={monitor} />
      {deleteDialog === null ? null : (
        <ConfirmDialog
          title="ยืนยันการลบมอนิเตอร์"
          description={
            <>
              <p>
                ลบ {monitor.name} (
                <span className="font-mono">{monitor.url}</span>) ออกจากองค์กร{" "}
                {organization.name}
              </p>
              <p className="mt-2">
                ประวัติการตรวจและเหตุการณ์จะหายและกู้คืนไม่ได้
                ถ้าต้องการเก็บประวัติ ให้ใช้หยุดชั่วคราวแทน
              </p>
            </>
          }
          confirmLabel="ลบมอนิเตอร์"
          confirmVariant="destructive"
          pendingLabel="กำลังลบ…"
          pending={remove.isPending}
          opener={deleteDialog.opener}
          fallbackFocus={heading}
          onCancel={() => {
            setDeleteDialog(null);
          }}
          onConfirm={() => {
            remove.mutate();
          }}
        />
      )}
    </Page>
  );
}
