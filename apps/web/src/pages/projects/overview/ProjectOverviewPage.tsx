import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { EmptyState } from "../../../components/shell/EmptyState";
import { ActivityIcon } from "../../../components/shell/icons";
import { Page, PageHeader } from "../../../components/shell/Page";
import { PageState } from "../../../components/shell/PageState";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { SectionHeader } from "../../../components/ui/section-header";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  MONITOR_LIST_PAGE_SIZE,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
} from "../../../lib/api/monitors";
import {
  fetchProjectDetail,
  projectQueryKeys,
} from "../../../lib/api/projects";
import { useLeaveOnOrganizationSwitch } from "../../../lib/tenant/useLeaveOnOrganizationSwitch";
import { useTenant } from "../../../lib/tenant/TenantProvider";
import {
  formatTime,
  formatTimeWithSeconds,
  Time,
  TIME_ZONE,
} from "../../monitors/format";
import {
  isDenied,
  isMonitorNotFound,
  useMonitorAccess,
} from "../../monitors/useMonitorAccess";
import { PROJECT_GONE_NOTICE } from "../members/ProjectMembersPage";
import { EventsSection } from "./EventsSection";

export function ProjectOverviewPage() {
  const { organizationId, projectId } = useParams();
  if (organizationId === undefined || projectId === undefined) return null;
  return (
    <OverviewForProject
      key={`${organizationId}:${projectId}`}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}

function OverviewForProject({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { mePending, meError, refreshMembershipContext } = useTenant();
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const access = useMonitorAccess(organizationId, projectId, !switched);
  const enabled = access.organization !== undefined && !switched && !mePending;
  const project = useQuery({
    queryKey: projectQueryKeys.detail(organizationId, projectId),
    queryFn: () => fetchProjectDetail(organizationId, projectId),
    enabled,
  });
  const listParams = { limit: MONITOR_LIST_PAGE_SIZE, offset: 0 };
  const list = useQuery({
    queryKey: monitorQueryKeys.list(organizationId, projectId, listParams),
    queryFn: () => fetchMonitorList(organizationId, projectId, listParams),
    enabled,
    refetchInterval: (query) =>
      isDenied(query.state.error) || isMonitorNotFound(query.state.error)
        ? false
        : MONITOR_REFETCH_INTERVAL_MS,
  });
  const events = useQuery({
    queryKey: monitorQueryKeys.recentEvents(organizationId, projectId),
    queryFn: () => fetchMonitorRecentEvents(organizationId, projectId),
    enabled,
    refetchInterval: (query) =>
      isDenied(query.state.error) || isMonitorNotFound(query.state.error)
        ? false
        : MONITOR_REFETCH_INTERVAL_MS,
  });
  const errors = [list.error, events.error, project.error];
  const denied = errors.some(isDenied);
  const gone = access.projectGone || errors.some(isMonitorNotFound);
  const [contextRefresh, setContextRefresh] = useState<
    "idle" | "refreshing" | "done"
  >("idle");
  const refreshAccess = access.refresh;
  const refreshed = useRef(false);
  useEffect(() => {
    if (!denied || refreshed.current) return;
    refreshed.current = true;
    setContextRefresh("refreshing");
    void Promise.all([refreshMembershipContext(), refreshAccess()]).finally(
      () => {
        setContextRefresh("done");
      },
    );
  }, [denied, refreshMembershipContext, refreshAccess]);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (gone)
      void queryClient.invalidateQueries({
        queryKey: projectQueryKeys.all(organizationId),
      });
  }, [gone, queryClient, organizationId]);

  const data = denied || gone || !enabled ? undefined : list.data;
  const header = (
    <PageHeader
      eyebrow="// overview"
      title="ภาพรวม"
      titleTestId="project-overview-heading"
      scope={
        denied || gone || !enabled || access.project === undefined
          ? undefined
          : {
              mark: access.project.name,
              label: access.project.name,
              tag: access.roleTag,
            }
      }
      scopeTestId="project-overview-scope"
      status={
        data === undefined ? undefined : (
          <span>
            ข้อมูล ณ{" "}
            <span className="font-mono">
              <Time
                testId="project-overview-as-of"
                iso={data.dataAsOf}
                format={formatTimeWithSeconds}
              />
            </span>{" "}
            (<span className="font-mono">{TIME_ZONE}</span>)
          </span>
        )
      }
    />
  );
  const projectsPath = `/organizations/${organizationId}/projects`;
  const monitorsPath = `${projectsPath}/${projectId}/monitors`;
  let state;
  if (mePending || switched || contextRefresh === "refreshing") {
    state = (
      <PageState
        data-testid="project-overview-loading"
        kind="loading"
        label="กำลังโหลดภาพรวม"
      />
    );
  } else if (meError !== null) {
    state = (
      <PageState
        data-testid="project-overview-context-error"
        kind="error"
        message="ไม่สามารถยืนยันสิทธิ์ดูภาพรวมได้"
        retryLabel="ลองใหม่"
        onRetry={() => void refreshMembershipContext()}
      />
    );
  } else if (gone) {
    state = (
      <PageState
        data-testid="project-overview-project-gone"
        kind="denied"
        tone="info"
        message={PROJECT_GONE_NOTICE}
        action={
          <Button asChild variant="secondary">
            <Link to={projectsPath}>ไปที่รายการโปรเจกต์</Link>
          </Button>
        }
      />
    );
  } else if (access.organization === undefined || denied) {
    state = (
      <PageState
        data-testid="project-overview-denied"
        kind="denied"
        message="คุณไม่มีสิทธิ์ดูภาพรวมของโปรเจกต์นี้"
      />
    );
  } else if (project.data === undefined && project.isError) {
    state = (
      <PageState
        data-testid="project-overview-access-error"
        kind="error"
        message="ตรวจสอบสิทธิ์ในโปรเจกต์นี้ไม่สำเร็จ"
        retryLabel="ลองใหม่"
        onRetry={access.retry}
      />
    );
  } else if (access.pending || data === undefined) {
    state = list.isError ? (
      <PageState
        data-testid="project-overview-error"
        kind="error"
        message="โหลดมอนิเตอร์ไม่สำเร็จ"
        retryLabel="ลองใหม่"
        onRetry={() => void list.refetch()}
      />
    ) : (
      <PageState
        data-testid="project-overview-loading"
        kind="loading"
        label="กำลังโหลดภาพรวม"
      />
    );
  }
  if (state !== undefined)
    return (
      <Page>
        {header}
        {state}
      </Page>
    );
  if (data === undefined) return null;

  return (
    <Page>
      {header}
      {list.isError ? (
        <Alert data-testid="project-overview-stale" tone="warning">
          อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ{" "}
          <Time iso={data.dataAsOf} format={formatTimeWithSeconds} />
        </Alert>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {data.summary.total === 0 ? (
            <EmptyState
              data-testid="project-overview-empty"
              variant="first-run"
              icon={<ActivityIcon size={20} />}
              title="ยังไม่มีมอนิเตอร์ในโปรเจกต์นี้"
              description={
                access.canWrite ? undefined : "สิทธิ์ของคุณ: ดูอย่างเดียว"
              }
              action={
                access.canWrite ? (
                  <Button asChild>
                    <Link
                      data-testid="project-overview-add"
                      to={`${monitorsPath}/new`}
                    >
                      เพิ่มมอนิเตอร์
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {data.summary.down > 0 ? (
                <section
                  role="alert"
                  data-testid="project-overview-down-banner"
                  className="rounded-md border border-danger bg-danger-tint p-4"
                >
                  <h2 className="flex items-center gap-2 text-base font-semibold text-danger">
                    <ActivityIcon size={20} />
                    ล่ม <span className="font-mono">
                      {data.summary.down}
                    </span>{" "}
                    มอนิเตอร์
                  </h2>
                  <ul>
                    {data.monitors
                      .filter((monitor) => monitor.health === "down")
                      .map((monitor) => (
                        <li
                          key={monitor.id}
                          data-testid="project-overview-down-row"
                          className="flex flex-wrap items-center gap-2 py-2 text-sm"
                        >
                          <Link
                            className="text-primary underline"
                            to={`${monitorsPath}/${monitor.id}`}
                          >
                            {monitor.name}
                          </Link>
                          <span className="font-mono">
                            {monitor.openIncident?.reason ??
                              monitor.healthReason}
                          </span>
                          {monitor.openIncident === null ? null : (
                            <span>
                              ตั้งแต่{" "}
                              <Time
                                iso={monitor.openIncident.startedAt}
                                format={formatTime}
                              />
                            </span>
                          )}
                        </li>
                      ))}
                  </ul>
                  <Link className="text-primary underline" to={monitorsPath}>
                    ดูมอนิเตอร์
                  </Link>
                </section>
              ) : null}
              <section
                aria-label="สรุปมอนิเตอร์"
                data-testid="project-overview-summary"
              >
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-foreground/10 bg-foreground/10 sm:grid-cols-4">
                  {(
                    [
                      ["total", "มอนิเตอร์ทั้งหมด"],
                      ["up", "ใช้งานได้"],
                      ["down", "ล่ม"],
                      ["paused", "หยุดชั่วคราว"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="bg-surface p-4">
                      <dt className="text-xs text-foreground-secondary">
                        {label}
                      </dt>
                      <dd
                        data-testid={`project-overview-${key}`}
                        className={`mt-2 font-mono text-2xl tabular-nums ${key === "down" && data.summary.down > 0 ? "text-danger" : "text-heading"}`}
                      >
                        {data.summary[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
                {data.summary.unknown > 0 ? (
                  <p className="mt-2 text-sm text-foreground-secondary">
                    ยังไม่ทราบสถานะ{" "}
                    <span
                      data-testid="project-overview-unknown"
                      className="font-mono"
                    >
                      {data.summary.unknown}
                    </span>{" "}
                    มอนิเตอร์
                  </p>
                ) : null}
              </section>
              <EventsSection
                organizationId={organizationId}
                projectId={projectId}
                events={events}
              />
            </>
          )}
        </div>
        <section
          data-testid="project-overview-members"
          aria-labelledby="overview-members"
          className="self-start rounded-md border border-foreground/10 bg-surface p-4"
        >
          <SectionHeader id="overview-members" title="สมาชิกโปรเจกต์" />
          <p className="py-4 text-sm">
            {project.data === undefined || project.isError ? (
              <span data-testid="project-overview-members-unknown">
                ไม่ทราบ
              </span>
            ) : (
              <>
                <span
                  data-testid="project-overview-member-count"
                  className="font-mono"
                >
                  {project.data.memberCount}
                </span>{" "}
                คน · ผู้ดูแล{" "}
                <span
                  data-testid="project-overview-admin-count"
                  className="font-mono"
                >
                  {project.data.adminCount}
                </span>{" "}
                คน
              </>
            )}
          </p>
          <Link
            data-testid="project-overview-members-link"
            className="text-sm text-primary underline"
            to={`${projectsPath}/${projectId}/members`}
          >
            จัดการสมาชิก
          </Link>
        </section>
      </div>
    </Page>
  );
}
