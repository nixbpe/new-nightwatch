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
  // Lives above the overview: the context refresh unmounts it while /me reloads.
  const [refresh, setRefresh] = useState<{
    key: string;
    phase: ContextRefresh;
  } | null>(null);

  if (mePending) {
    return (
      <Page>
        <PageHeader title="ภาพรวม" />
        <PageState kind="loading" label="กำลังโหลดข้อมูลองค์กร…" />
      </Page>
    );
  }

  if (me === undefined) {
    // A failed request is never "zero memberships"; offer an explicit retry.
    return (
      <Page>
        <PageHeader title="โหลดข้อมูลองค์กรไม่สำเร็จ" />
        <PageState
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

  const refreshKey = `${activeOrg.id}:${activeOrg.role}`;
  return (
    <OrganizationOverview
      key={activeOrg.id}
      organization={activeOrg}
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
  contextRefresh,
  setContextRefresh,
}: {
  organization: ActiveOrganization;
  contextRefresh: ContextRefresh;
  setContextRefresh: (phase: ContextRefresh) => void;
}) {
  const { refreshMembershipContext } = useTenant();
  const list = useQuery({
    queryKey: monitorQueryKeys.list(organization.id, OVERVIEW_LIST_PARAMS),
    queryFn: () => fetchMonitorList(organization.id, OVERVIEW_LIST_PARAMS),
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
  const monitorsPath = `/organizations/${organization.id}/monitors`;
  const canWrite =
    organization.role === "owner" || organization.role === "admin";
  const firstRun = data !== undefined && data.summary.total === 0;
  const limitReached =
    data !== undefined && data.summary.total >= data.summary.limit;

  let actions: ReactNode;
  if (data !== undefined && !firstRun) {
    actions = (
      <>
        <Button asChild variant="secondary">
          <Link to={monitorsPath}>ดูมอนิเตอร์ทั้งหมด</Link>
        </Button>
        {canWrite && limitReached ? (
          <>
            <span
              id="monitor-limit-reason"
              className="text-xs text-foreground-secondary"
            >
              องค์กรนี้มีมอนิเตอร์ครบ {data.summary.limit} ตัวแล้ว
              ลบมอนิเตอร์เดิมก่อนจึงจะเพิ่มได้
            </span>
            <Button
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
            <Link to={`${monitorsPath}/new`}>เพิ่มมอนิเตอร์</Link>
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
          <PageState kind="loading" label="กำลังตรวจสอบสิทธิ์ดูมอนิเตอร์" />
        ) : (
          <PageState
            kind="denied"
            message="คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"
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
            <span>
              slug <span className="font-mono">{organization.slug}</span>
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
                      aria-hidden="true"
                      className="live-pulse size-[6px] shrink-0 rounded-full bg-primary"
                    />
                  )}
                  <span>
                    ข้อมูล ณ{" "}
                    <span className="font-mono">
                      <Time
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
            kind="error"
            message="โหลดมอนิเตอร์ไม่สำเร็จ"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => void list.refetch()}
          />
        ) : (
          <PageState
            kind="loading"
            label="กำลังโหลดมอนิเตอร์"
            layout="table"
            visibleLabel
          />
        )
      ) : firstRun ? (
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
                <Link to={`${monitorsPath}/new`}>เพิ่มมอนิเตอร์</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {list.isError ? (
            <Alert tone="warning">
              อัปเดตข้อมูลไม่สำเร็จ กำลังแสดงข้อมูล ณ{" "}
              <Time iso={data.dataAsOf} format={formatTimeWithSeconds} />
            </Alert>
          ) : null}
          <StatStrip
            organizationId={organization.id}
            summary={data.summary}
            monitors={data.monitors}
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <IssuesSection
              organizationId={organization.id}
              monitors={data.monitors}
              now={Date.parse(data.dataAsOf)}
            />
            <EventsSection organizationId={organization.id} />
          </div>
          <UptimeSection
            organizationId={organization.id}
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
