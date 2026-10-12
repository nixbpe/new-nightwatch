import type { ProjectSummary } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { EmptyState } from "../components/shell/EmptyState";
import { ActivityIcon } from "../components/shell/icons";
import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import {
  fetchMonitorList,
  MONITOR_REFETCH_INTERVAL_MS,
  monitorQueryKeys,
  OVERVIEW_LIST_PARAMS,
} from "../lib/api/monitors";
import { authClient } from "../lib/auth-client";
import { useCurrentProject } from "../components/shell/useCurrentProject";
import { PROJECT_ROLE_LABELS } from "./projects/members/roles";
import { ROLE_LABELS } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";
import { formatTimeWithSeconds, Time, TIME_ZONE } from "./monitors/format";
import { useFocusHeadingAfterSelfLeave } from "./organization-members/SelfLeaveAction";
import { EventsSection } from "./workspace/EventsSection";
import { IssuesSection } from "./workspace/IssuesSection";
import { StatStrip } from "./workspace/StatStrip";
import { isDenied } from "./workspace/rows";
import { UptimeSection } from "./workspace/UptimeSection";

export function WorkspacePage() {
  const { me, mePending, meError, retryMe, activeOrg } = useTenant();
  // The overview shows the monitors of one Project: the current one, as the sidebar resolves it.
  const current = useCurrentProject();
  // Lives above the overview: the context refresh unmounts it while /me reloads.
  const [refresh, setRefresh] = useState<{
    key: string;
    phase: ContextRefresh;
  } | null>(null);

  if (mePending) {
    return (
      <Page>
        <PageHeader title="ภาพรวม" />
        <PageState
          data-testid="workspace-context-loading"
          kind="loading"
          label="กำลังโหลดข้อมูลองค์กร…"
        />
      </Page>
    );
  }

  if (me === undefined) {
    // A failed request is never "zero memberships"; offer an explicit retry.
    return (
      <Page>
        <PageHeader title="โหลดข้อมูลองค์กรไม่สำเร็จ" />
        <PageState
          data-testid="workspace-context-error"
          alertTestId="workspace-context-alert"
          retryTestId="workspace-context-retry"
          kind="error"
          message={
            meError?.message ||
            "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"
          }
          retryLabel="ลองใหม่"
          onRetry={() => {
            void retryMe();
          }}
        />
      </Page>
    );
  }

  if (activeOrg === null) {
    return <AccessNeeded email={me.user.email} />;
  }

  if (current.status === "loading") {
    return (
      <Page>
        <PageHeader title="ภาพรวม" />
        <PageState
          data-testid="workspace-project-loading"
          kind="loading"
          label="กำลังโหลดโปรเจกต์…"
        />
      </Page>
    );
  }
  if (current.status === "error") {
    return (
      <Page>
        <PageHeader title="ภาพรวม" />
        <PageState
          data-testid="workspace-project-error"
          retryTestId="workspace-project-retry"
          kind="error"
          message="โหลดโปรเจกต์ไม่สำเร็จ"
          retryLabel="ลองอีกครั้ง"
          onRetry={current.refetch}
        />
      </Page>
    );
  }
  if (current.project === null || current.organizationId !== activeOrg.id) {
    return (
      <Page>
        <PageHeader
          eyebrow="// overview"
          scope={{
            mark: activeOrg.name,
            label: activeOrg.name,
            tag: ROLE_LABELS[activeOrg.role] ?? activeOrg.role,
          }}
          title="ภาพรวม"
        />
        <EmptyState
          data-testid="workspace-no-project"
          variant="first-run"
          icon={<ActivityIcon size={20} />}
          title="ยังไม่มีโปรเจกต์ที่คุณเข้าถึงได้"
          description="มอนิเตอร์อยู่ภายใต้โปรเจกต์ เลือกหรือสร้างโปรเจกต์เพื่อเริ่มตรวจสถานะบริการ"
          action={
            <Button asChild>
              <Link
                data-testid="workspace-projects-link"
                to={`/organizations/${activeOrg.id}/projects`}
              >
                ไปที่รายการโปรเจกต์
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const refreshKey = `${activeOrg.id}:${current.project.id}:${activeOrg.role}:${current.project.myRole ?? ""}`;
  return (
    <OrganizationOverview
      key={`${activeOrg.id}:${current.project.id}`}
      organization={activeOrg}
      project={current.project}
      contextRefresh={refresh?.key === refreshKey ? refresh.phase : "idle"}
      setContextRefresh={(phase) => {
        setRefresh({ key: refreshKey, phase });
      }}
    />
  );
}

type ContextRefresh = "idle" | "refreshing" | "done";

type ActiveOrganization = NonNullable<
  ReturnType<typeof useTenant>["activeOrg"]
>;

function OrganizationOverview({
  organization,
  project,
  contextRefresh,
  setContextRefresh,
}: {
  organization: ActiveOrganization;
  project: ProjectSummary;
  contextRefresh: ContextRefresh;
  setContextRefresh: (phase: ContextRefresh) => void;
}) {
  const { refreshMembershipContext } = useTenant();
  const list = useQuery({
    queryKey: monitorQueryKeys.list(
      organization.id,
      project.id,
      OVERVIEW_LIST_PARAMS,
    ),
    queryFn: () =>
      fetchMonitorList(organization.id, project.id, OVERVIEW_LIST_PARAMS),
    refetchInterval: MONITOR_REFETCH_INTERVAL_MS,
  });
  const denied = isDenied(list.error);
  useEffect(() => {
    if (!denied || contextRefresh !== "idle") return;
    setContextRefresh("refreshing");
    void refreshMembershipContext().finally(() => {
      setContextRefresh("done");
    });
  }, [denied, contextRefresh, setContextRefresh, refreshMembershipContext]);
  const data = denied ? undefined : list.data;
  const monitorsPath = `/organizations/${organization.id}/projects/${project.id}/monitors`;
  const canWrite =
    organization.role === "owner" ||
    organization.role === "admin" ||
    project.myRole === "admin";
  const firstRun = data !== undefined && data.summary.total === 0;
  const limitReached =
    data !== undefined && data.summary.total >= data.summary.limit;

  let actions: ReactNode;
  if (data !== undefined && !firstRun) {
    actions = (
      <>
        <Button asChild variant="secondary">
          <Link data-testid="workspace-monitors" to={monitorsPath}>
            ดูมอนิเตอร์ทั้งหมด
          </Link>
        </Button>
        {canWrite && limitReached ? (
          <>
            <span
              data-testid="workspace-limit-reason"
              id="monitor-limit-reason"
              className="text-xs text-foreground-secondary"
            >
              โปรเจกต์นี้มีมอนิเตอร์ครบ {data.summary.limit} ตัวแล้ว
              ลบมอนิเตอร์เดิมก่อนจึงจะเพิ่มได้
            </span>
            <Button
              data-testid="workspace-add-disabled"
              type="button"
              disabled
              aria-describedby="monitor-limit-reason"
            >
              เพิ่มมอนิเตอร์
            </Button>
          </>
        ) : null}
        {canWrite && !limitReached ? (
          <Button asChild>
            <Link data-testid="workspace-add" to={`${monitorsPath}/new`}>
              เพิ่มมอนิเตอร์
            </Link>
          </Button>
        ) : null}
      </>
    );
  }

  if (denied) {
    // No scope, counts or rows: a non-member learns nothing about this organization.
    return (
      <Page>
        <PageHeader eyebrow="// overview" title="ภาพรวม" />
        {contextRefresh === "refreshing" ? (
          <PageState
            data-testid="workspace-admission-loading"
            kind="loading"
            label="กำลังตรวจสอบสิทธิ์ดูมอนิเตอร์"
          />
        ) : (
          <PageState
            data-testid="workspace-denied"
            kind="denied"
            message="คุณไม่มีสิทธิ์ดูมอนิเตอร์ของโปรเจกต์นี้"
          />
        )}
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="// overview"
        scope={{
          mark: organization.name,
          label: organization.name,
          tag: ROLE_LABELS[organization.role] ?? organization.role,
        }}
        title="ภาพรวม"
        actions={actions}
        // Names are not unique across organizations, so the slug stays visible.
        status={
          <>
            <span
              data-testid="workspace-identity"
              data-organization-id={organization.id}
              data-member-role={organization.role}
            >
              slug{" "}
              <span data-testid="workspace-slug" className="font-mono">
                {organization.slug}
              </span>
            </span>
            <span>
              โปรเจกต์{" "}
              <span data-testid="workspace-project" className="font-medium">
                {project.name}
              </span>
              {project.myRole === null
                ? null
                : ` · ${PROJECT_ROLE_LABELS[project.myRole]}`}
            </span>
            {data === undefined ? null : (
              <>
                <span>
                  มอนิเตอร์{" "}
                  <span className="font-mono">{data.summary.total}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {list.isError ? null : (
                    <span
                      data-testid="workspace-fresh"
                      aria-hidden="true"
                      className="live-pulse size-[6px] shrink-0 rounded-full bg-primary"
                    />
                  )}
                  <span>
                    ข้อมูล ณ{" "}
                    <span className="font-mono">
                      <Time
                        testId="workspace-as-of"
                        iso={data.dataAsOf}
                        format={formatTimeWithSeconds}
                      />
                    </span>{" "}
                    (<span className="font-mono">{TIME_ZONE}</span>)
                  </span>
                </span>
              </>
            )}
          </>
        }
      />
      {data === undefined ? (
        list.isError ? (
          <PageState
            data-testid="workspace-list-error"
            retryTestId="workspace-list-retry"
            kind="error"
            message="โหลดมอนิเตอร์ไม่สำเร็จ"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => void list.refetch()}
          />
        ) : (
          <PageState
            data-testid="workspace-list-loading"
            kind="loading"
            label="กำลังโหลดมอนิเตอร์"
            layout="table"
            visibleLabel
          />
        )
      ) : firstRun ? (
        <EmptyState
          data-testid="workspace-empty"
          variant="first-run"
          icon={<ActivityIcon size={20} />}
          title="ยังไม่มีมอนิเตอร์"
          description={
            canWrite
              ? "เพิ่มเว็บไซต์หรือ API เพื่อให้ NightWatch ตรวจสถานะเป็นระยะและแจ้งเมื่อล่มหรือ SSL ใกล้หมดอายุ"
              : "ผู้ดูแลโปรเจกต์หรือเจ้าของและผู้ดูแลองค์กรเพิ่มได้"
          }
          action={
            canWrite ? (
              <Button asChild>
                <Link
                  data-testid="workspace-empty-add"
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
          {list.isError ? (
            <Alert data-testid="workspace-refetch-error" tone="warning">
              อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ{" "}
              <Time
                testId="workspace-refetch-time"
                iso={data.dataAsOf}
                format={formatTimeWithSeconds}
              />
            </Alert>
          ) : null}
          <StatStrip
            organizationId={organization.id}
            projectId={project.id}
            summary={data.summary}
            monitors={data.monitors}
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <IssuesSection
              organizationId={organization.id}
              projectId={project.id}
              monitors={data.monitors}
              now={Date.parse(data.dataAsOf)}
            />
            <EventsSection
              organizationId={organization.id}
              projectId={project.id}
            />
          </div>
          <UptimeSection
            organizationId={organization.id}
            projectId={project.id}
            monitors={data.monitors}
            total={data.summary.total}
          />
        </>
      )}
    </Page>
  );
}

function AccessNeeded({ email }: { email: string }) {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusHeadingAfterSelfLeave(headingRef);
  return (
    <Page>
      <PageHeader
        title="ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร"
        titleRef={headingRef}
        titleTabIndex={-1}
        titleClassName="outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      <PageState
        data-testid="workspace-access-needed"
        kind="denied"
        tone="info"
        message={
          <>
            บัญชี {email} ยังไม่เป็นสมาชิกขององค์กรใด
            การเข้าถึงต้องได้รับคำเชิญจากผู้ดูแลองค์กร หากคุณเพิ่งรับคำเชิญ
            กรุณาเปิดลิงก์จากอีเมลอีกครั้งหลังเข้าสู่ระบบ
          </>
        }
        action={
          <Button
            data-testid="workspace-sign-out"
            type="button"
            variant="secondary"
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    void navigate("/login", { replace: true });
                  },
                },
              });
            }}
          >
            ออกจากระบบ
          </Button>
        }
      />
    </Page>
  );
}
