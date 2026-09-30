import { useQuery } from "@tanstack/react-query";
import type { MonitorRecord } from "@nightwatch/api-contract";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Page, PageHeader } from "../../components/shell/Page";
import { PageState } from "../../components/shell/PageState";
import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { fetchMonitorDetail, monitorQueryKeys } from "../../lib/api/monitors";
import { useTenant } from "../../lib/tenant/TenantProvider";
import { MonitorForm } from "./form/MonitorForm";
import { useLeaveOnOrganizationSwitch } from "./useLeaveOnOrganizationSwitch";

const DENIED_MESSAGE = "คุณไม่มีสิทธิ์สร้างหรือแก้ไขมอนิเตอร์ขององค์กรนี้";

function isCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && codes.includes(error.code);
}

export function MonitorFormPage({ mode }: { mode: "create" | "edit" }) {
  const { organizationId, monitorId } = useParams();
  if (organizationId === undefined) return null;
  if (mode === "edit" && monitorId === undefined) return null;
  // Keyed so nothing typed carries over to another Organization or monitor.
  return (
    <MonitorFormForOrganization
      key={`${organizationId}:${monitorId ?? "new"}`}
      organizationId={organizationId}
      monitorId={mode === "edit" ? monitorId : undefined}
    />
  );
}

type Snapshot = {
  organization: { id: string; name: string; role: string };
  record: MonitorRecord | undefined;
};

function MonitorFormForOrganization({
  organizationId,
  monitorId,
}: {
  organizationId: string;
  monitorId: string | undefined;
}) {
  const { me, mePending, meError, refreshMembershipContext } = useTenant();
  const switched = useLeaveOnOrganizationSwitch(organizationId);
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const canWrite =
    organization?.role === "owner" || organization?.role === "admin";
  const editing = monitorId !== undefined;
  const overviewPath = `/organizations/${organizationId}/monitors`;

  const detail = useQuery({
    queryKey: monitorQueryKeys.detail(organizationId, monitorId ?? ""),
    queryFn: () => fetchMonitorDetail(organizationId, monitorId ?? ""),
    enabled: editing && canWrite && !switched,
    // The form pins what it loads: no polling and no refetch behind the user's back.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  // What the form opened with. It outlives the membership refresh that follows a
  // refusal (which empties `me` and the tenant queries), so typed values survive (AC-49).
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const record = detail.data?.monitor;
  if (snapshot === null && canWrite && (!editing || record !== undefined)) {
    setSnapshot({ organization, record });
  }
  // Bumped to open the form again from a fresh read after a version conflict.
  const [generation, setGeneration] = useState(0);
  const roleLost = useRef(false);
  if (me !== undefined) roleLost.current = !canWrite;

  const header = (
    <PageHeader
      scope={
        organization === undefined
          ? undefined
          : { mark: organization.name, label: organization.name }
      }
      title={editing ? "แก้ไขมอนิเตอร์" : "เพิ่มมอนิเตอร์"}
    />
  );
  const denied = (
    <Page width="form">
      {header}
      <PageState
        kind="denied"
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
  // Removed from the Organization: nothing typed stays on screen.
  if (me !== undefined && organization === undefined) return denied;
  if (snapshot !== null) {
    return (
      <MonitorForm
        key={generation}
        organization={organization ?? snapshot.organization}
        monitorId={monitorId}
        record={snapshot.record}
        roleLost={roleLost.current}
        onReload={async () => {
          const fresh = await detail.refetch();
          const next = fresh.data?.monitor;
          if (next !== undefined) {
            setSnapshot({ ...snapshot, record: next });
            setGeneration((current) => current + 1);
          }
        }}
      />
    );
  }
  if (mePending || me === undefined) {
    return (
      <Page width="form">
        {header}
        <PageState kind="loading" label="กำลังโหลดการตั้งค่า" />
      </Page>
    );
  }
  if (meError !== null) {
    return (
      <Page width="form">
        {header}
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ของคุณได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshMembershipContext()}
        />
      </Page>
    );
  }
  if (!canWrite) return denied;
  if (isCode(detail.error, "MONITOR_NOT_FOUND")) {
    return (
      <Page width="form">
        {header}
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
  if (isCode(detail.error, "MEMBERSHIP_DENIED", "PERMISSION_DENIED")) {
    return denied;
  }
  return (
    <Page width="form">
      {header}
      {detail.isError ? (
        <PageState
          kind="error"
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
