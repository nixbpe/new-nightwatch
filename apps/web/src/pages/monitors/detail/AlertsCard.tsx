import type {
  OrganizationNotificationSettings,
  Monitor,
} from "@nightwatch/api-contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { Skeleton } from "../../../components/shell/Skeleton";
import { Alert } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Card, CardHeader } from "../../../components/ui/card";
import { ApiError } from "../../../lib/api/client";
import { MONITOR_REFETCH_INTERVAL_MS } from "../../../lib/api/monitors";
import {
  fetchOrganizationNotificationSettings,
  organizationNotificationSettingsQueryKey,
} from "../../../lib/api/notifications";
import { ORG_ALERTS_OFF_MESSAGE } from "./labels";

function isDenied(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PERMISSION_DENIED";
}

function useOrgAlertsSetting(organizationId: string, canWrite: boolean) {
  return useQuery({
    queryKey: organizationNotificationSettingsQueryKey(organizationId),
    queryFn: () => fetchOrganizationNotificationSettings(organizationId),
    enabled: canWrite,
    refetchInterval: (current) =>
      isDenied(current.state.error) ? false : MONITOR_REFETCH_INTERVAL_MS,
  });
}

function OrgAlertsValue({
  org,
}: {
  org: UseQueryResult<OrganizationNotificationSettings>;
}) {
  if (isDenied(org.error)) {
    return (
      <span className="text-foreground-secondary">
        ไม่มีสิทธิ์ดูการตั้งค่านี้
      </span>
    );
  }
  if (org.isError) {
    return (
      <span className="inline-flex flex-col items-end gap-1.5">
        <Alert tone="error">โหลดไม่สำเร็จ</Alert>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void org.refetch()}
        >
          ลองอีกครั้ง
        </Button>
      </span>
    );
  }
  if (org.data === undefined) {
    return (
      <span aria-busy="true" className="inline-flex flex-col items-end gap-1">
        <span role="status" className="sr-only">
          กำลังโหลดการตั้งค่าระดับองค์กร
        </span>
        <Skeleton className="h-4 w-12" />
      </span>
    );
  }
  return <>{org.data.monitorAlertsEnabled ? "เปิด" : "ปิด"}</>;
}

export function AlertsCard({
  monitor,
  organizationId,
  canWrite,
}: {
  monitor: Monitor;
  organizationId: string;
  canWrite: boolean;
}) {
  const org = useOrgAlertsSetting(organizationId, canWrite);
  const orgKnownOff =
    canWrite && !org.isError && org.data?.monitorAlertsEnabled === false;
  return (
    <Card as="section" aria-labelledby="detail-alerts">
      <CardHeader
        id="detail-alerts"
        title="การแจ้งเตือน"
        className="border-b border-foreground/10 p-4"
      />
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 p-4 text-sm [&>dd]:text-right [&>dd]:break-words">
        {canWrite ? (
          <>
            <dt className="text-foreground-secondary">
              การแจ้งเตือนระดับองค์กร
            </dt>
            <dd>
              <OrgAlertsValue org={org} />
            </dd>
          </>
        ) : null}
        <dt className="text-foreground-secondary">เกณฑ์ล้มเหลว</dt>
        <dd>
          <span className="font-mono">{monitor.alerts.failureThreshold}</span>{" "}
          ครั้ง
        </dd>
        <dt className="text-foreground-secondary">แจ้งเมื่อล่มและกลับมาปกติ</dt>
        <dd>{monitor.alerts.downEnabled ? "เปิด" : "ปิด"}</dd>
        <dt className="text-foreground-secondary">แจ้งเมื่อ SSL ใกล้หมดอายุ</dt>
        <dd>
          {monitor.alerts.sslEnabled ? (
            <>
              เปิด (ล่วงหน้า{" "}
              <span className="font-mono">{monitor.alerts.sslCautionDays}</span>{" "}
              วัน)
            </>
          ) : (
            "ปิด"
          )}
          {monitor.ssl.state === "not_https" ? (
            <p className="mt-1 font-normal text-foreground-secondary">
              มอนิเตอร์นี้ใช้ http ไม่มีข้อมูลใบรับรอง
            </p>
          ) : null}
        </dd>
      </dl>
      {orgKnownOff ? (
        <p className="border-t border-foreground/10 px-4 py-3 text-sm text-foreground-secondary">
          {ORG_ALERTS_OFF_MESSAGE}
        </p>
      ) : null}
    </Card>
  );
}
