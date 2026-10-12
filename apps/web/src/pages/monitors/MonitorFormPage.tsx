import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MonitorRecord } from "@nightwatch/api-contract";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { fetchMonitorDetail, monitorQueryKeys } from "../../lib/api/monitors";
import { getContextPublicationSnapshot } from "../../lib/queryClient";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { PROJECT_GONE_NOTICE } from "../projects/members/ProjectMembersPage";
import { MonitorForm } from "./form/MonitorForm";
import { isMonitorNotFound, useMonitorAccess } from "./useMonitorAccess";
import { useLeaveOnOrganizationSwitch } from "../../lib/tenant/useLeaveOnOrganizationSwitch";

const DENIED_MESSAGE = "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ของโปรเจกต์นี้";

function isCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && codes.includes(error.code);
}

export function MonitorFormPage({ mode }: { mode: "create" | "edit" }) {
  const { organizationId, projectId, monitorId } = useParams();
  if (organizationId === undefined || projectId === undefined) return null;
  if (mode === "edit" && monitorId === undefined) return null;
  // Keyed so nothing typed carries over to another Project or monitor.
  return (
    <MonitorFormForOrganization
      key={`${organizationId}:${projectId}:${monitorId ?? "new"}`}
      organizationId={organizationId}
      projectId={projectId}
      monitorId={mode === "edit" ? monitorId : undefined}
    />
  );
}

type Snapshot = {
  organization: { id: string; name: string; role: string };
  project: { id: string; name: string; roleTag: string | undefined };
  record: MonitorRecord | undefined;
};

function MonitorFormForOrganization({
  organizationId,
  projectId,
  monitorId,
}: {
  organizationId: string;
  projectId: string;
  monitorId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const access = useMonitorAccess(organizationId, projectId, !switched);
  const { organization, project, canWrite } = access;
  // The latest write access, for an async reload that outlives the render that started it.
  const latestCanWrite = useRef(canWrite);
  latestCanWrite.current = canWrite;
  const canWriteNow = () => latestCanWrite.current;
  const editing = monitorId !== undefined;
  const overviewPath = `/organizations/${organizationId}/projects/${projectId}/monitors`;

  const detail = useQuery({
    queryKey: monitorQueryKeys.detail(
      organizationId,
      projectId,
      monitorId ?? "",
    ),
    queryFn: () =>
      fetchMonitorDetail(organizationId, projectId, monitorId ?? ""),
    enabled: editing && canWrite && !switched,
    // The form pins what it loads: no polling and no refetch behind the user's back.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const record = detail.data?.monitor;
  if (
    snapshot === null &&
    canWrite &&
    organization !== undefined &&
    project !== undefined &&
    (!editing || record !== undefined)
  ) {
    setSnapshot({
      organization,
      project: { id: project.id, name: project.name, roleTag: access.roleTag },
      record,
    });
  }
  // Bumped to open the form again from a fresh read after a version conflict.
  const [generation, setGeneration] = useState(0);
  const roleLost = useRef(false);
  if (me !== undefined) roleLost.current = !canWrite;

  const header = (
    <PageHeader
      titleTestId="monitor-form-title"
      scopeTestId="monitor-form-scope"
      scope={
        project === undefined
          ? undefined
          : { mark: project.name, label: project.name, tag: access.roleTag }
      }
      title={editing ? "แก้ไขมอนิเตอร์" : "เพิ่มมอนิเตอร์"}
    />
  );
  const gone = (
    <Page width="form">
      {header}
      <PageState
        kind="denied"
        data-testid="monitor-form-project-gone"
        tone="info"
        message={PROJECT_GONE_NOTICE}
        action={
          <Button asChild variant="secondary">
            <Link to={`/organizations/${organizationId}/projects`}>
              ไปที่รายการโปรเจกต์
            </Link>
          </Button>
        }
      />
    </Page>
  );
  const denied = (
    <Page width="form">
      {header}
      <PageState
        kind="denied"
        data-testid="monitor-form-denied"
        message={DENIED_MESSAGE}
        action={
          <Button asChild variant="secondary">
            <Link to={overviewPath}>กลับไปรายการมอนิเตอร์</Link>
          </Button>
        }
      />
    </Page>
  );

  if (switched) {
    return (
      <Page width="form">
        {header}
        <PageState kind="loading" label="กำลังโหลดการตั้งค่า" />
      </Page>
    );
  }
  if (me !== undefined && organization === undefined) return denied;
  // Also with a snapshot: a Project deleted or lost after the form opened leaves nothing to save into.
  if (access.projectGone) return gone;
  if (snapshot !== null) {
    return (
      <>
        {meError !== null ? (
          <PageState
            kind="error"
            data-testid="monitor-form-admission-error"
            retryTestId="monitor-form-admission-retry"
            message="ไม่สามารถยืนยันสิทธิ์ของคุณได้"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => void refreshMembershipContext()}
          />
        ) : null}
        <MonitorForm
          key={generation}
          organization={organization ?? snapshot.organization}
          project={snapshot.project}
          projectId={projectId}
          onAccessRefresh={access.refresh}
          monitorId={monitorId}
          record={snapshot.record}
          roleLost={roleLost.current || me === undefined}
          onReload={async () => {
            const before = getContextPublicationSnapshot(queryClient);
            if (before.admission.kind !== "confirmed" || !canWriteNow()) return;
            const fresh = await detail.refetch();
            const current = getContextPublicationSnapshot(queryClient);
            if (
              current.admission.kind !== "confirmed" ||
              current.requiredGeneration !== before.requiredGeneration ||
              current.publishedClaim !== before.publishedClaim
            )
              return;
            const membership = current.admission.context.organizations.find(
              (item) => item.id === organizationId,
            );
            if (membership === undefined || !canWriteNow()) return;
            const next = fresh.data?.monitor;
            if (next !== undefined) {
              setSnapshot({ ...snapshot, record: next });
              setGeneration((current) => current + 1);
            }
          }}
        />
      </>
    );
  }
  if (meError !== null) {
    return (
      <Page width="form">
        {header}
        <PageState
          kind="error"
          data-testid="monitor-form-admission-error"
          retryTestId="monitor-form-admission-retry"
          message="ไม่สามารถยืนยันสิทธิ์ของคุณได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshMembershipContext()}
        />
      </Page>
    );
  }
  if (mePending || me === undefined || access.pending) {
    return (
      <Page width="form">
        {header}
        <PageState kind="loading" label="กำลังโหลดการตั้งค่า" />
      </Page>
    );
  }
  if (!canWrite) return denied;
  if (isMonitorNotFound(detail.error)) {
    return (
      <Page width="form">
        {header}
        <PageState
          kind="denied"
          data-testid="monitor-form-not-found"
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
  if (isCode(detail.error, "MEMBERSHIP_DENIED", "PERMISSION_DENIED")) {
    return denied;
  }
  return (
    <Page width="form">
      {header}
      {detail.isError ? (
        <PageState
          kind="error"
          data-testid="monitor-form-load-error"
          retryTestId="monitor-form-load-retry"
          message="โหลดการตั้งค่าไม่สำเร็จ"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <PageState kind="loading" label="กำลังโหลดการตั้งค่า" />
      )}
    </Page>
  );
}
