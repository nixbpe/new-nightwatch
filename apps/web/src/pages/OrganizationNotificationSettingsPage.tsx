import type { NotificationSettingsUpdate } from "@nightwatch/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { Notice } from "../components/ui/notice";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationNotificationSettings,
  organizationNotificationSettingsQueryKey,
  updateOrganizationNotificationSettings,
} from "../lib/api/notifications";
import { useTenant } from "../lib/tenant/TenantProvider";
import { Card, CardFooter, CardHeader } from "../components/ui/card";

export function OrganizationNotificationSettingsPage() {
  const organizationId = useParams().organizationId;

  if (organizationId === undefined) return null;

  return (
    // Keyed so an unsaved draft never carries over to another organization.
    <OrganizationNotificationSettingsForOrganization
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

function OrganizationNotificationSettingsForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const client = useQueryClient();
  // null keeps the saved value; only a toggled setting is sent.
  const [draft, setDraft] = useState<{
    settingsChangedEnabled: boolean | null;
    monitorAlertsEnabled: boolean | null;
  }>({ settingsChangedEnabled: null, monitorAlertsEnabled: null });
  const settingsQueryKey =
    organizationNotificationSettingsQueryKey(organizationId);
  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => fetchOrganizationNotificationSettings(organizationId),
  });
  const save = useMutation({
    mutationFn: (update: NotificationSettingsUpdate) =>
      updateOrganizationNotificationSettings(organizationId, update),
    onSuccess: async () => {
      setDraft({ settingsChangedEnabled: null, monitorAlertsEnabled: null });
      await client.invalidateQueries({
        queryKey: settingsQueryKey,
      });
    },
  });
  // A bookmarked URL may name a non-active org, so the scope line names it, with the slug since names repeat.
  const { me } = useTenant();
  const organization = me?.organizations.find(
    (org) => org.id === organizationId,
  );
  const header = (
    <PageHeader
      scope={
        organization === undefined
          ? { label: "ตั้งค่าองค์กร" }
          : {
              mark: organization.name,
              label: organization.name,
              tag: "ตั้งค่าองค์กร",
            }
      }
      title="ตั้งค่าการแจ้งเตือน"
      status={
        organization === undefined ? undefined : (
          <span>
            slug <span className="font-mono">{organization.slug}</span>
          </span>
        )
      }
      description="ใช้กับสมาชิกทุกคนขององค์กรนี้"
    />
  );
  if (settings.isPending)
    return (
      <Page width="form">
        {header}
        <PageState kind="loading" label="กำลังโหลดการตั้งค่า…" />
      </Page>
    );
  if (settings.isError)
    return (
      <Page width="form">
        {header}
        {settings.error instanceof ApiError &&
        ["PERMISSION_DENIED", "MEMBERSHIP_DENIED"].includes(
          settings.error.code,
        ) ? (
          <PageState
            kind="denied"
            message="คุณไม่มีสิทธิ์จัดการการตั้งค่านี้"
          />
        ) : (
          <PageState
            kind="error"
            message="โหลดการตั้งค่าไม่สำเร็จ"
            retryLabel="ลองใหม่"
            onRetry={() => void settings.refetch()}
          />
        )}
      </Page>
    );
  const settingsData = settings.data;
  const settingsChanged =
    draft.settingsChangedEnabled ?? settingsData.settingsChangedEnabled;
  const monitorAlerts =
    draft.monitorAlertsEnabled ?? settingsData.monitorAlertsEnabled;
  const changed =
    settingsChanged !== settingsData.settingsChangedEnabled ||
    monitorAlerts !== settingsData.monitorAlertsEnabled;
  return (
    <Page width="form">
      {header}
      <Card
        as="section"
        aria-labelledby="notification-settings-card-title"
        padding="md"
      >
        <CardHeader
          id="notification-settings-card-title"
          title="ตั้งค่าการแจ้งเตือน"
        />
        {save.isError ? (
          <div className="flex flex-col gap-3">
            <Alert tone="error">
              {save.error instanceof ApiError &&
              save.error.code === "SETTINGS_VERSION_CONFLICT"
                ? "การตั้งค่าถูกเปลี่ยนโดยผู้อื่น กรุณาโหลดใหม่"
                : "บันทึกการตั้งค่าไม่สำเร็จ"}
            </Alert>
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  save.reset();
                  setDraft({
                    settingsChangedEnabled: null,
                    monitorAlertsEnabled: null,
                  });
                  void settings.refetch();
                }}
              >
                ลองใหม่
              </Button>
            </div>
          </div>
        ) : null}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settingsChanged}
            onChange={(event) => {
              setDraft({
                ...draft,
                settingsChangedEnabled: event.target.checked,
              });
            }}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            <span className="block font-medium">
              แจ้งเมื่อมีการเปลี่ยนการตั้งค่าการแจ้งเตือน
            </span>
            <span className="text-sm text-foreground-secondary">
              เจ้าของและผู้ดูแลคนอื่นจะได้รับการแจ้งเตือนเมื่อมีการเปลี่ยนแปลง
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={monitorAlerts}
            onChange={(event) => {
              setDraft({
                ...draft,
                monitorAlertsEnabled: event.target.checked,
              });
            }}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            <span className="block font-medium">แจ้งเตือนมอนิเตอร์</span>
            <span className="text-sm text-foreground-secondary">
              เจ้าของและผู้ดูแลจะได้รับการแจ้งเตือนเมื่อมอนิเตอร์ล่ม
              กลับมาทำงานหลังจากที่แจ้งว่าล่มแล้ว และเมื่อใบรับรอง SSL
              ใกล้หมดอายุหรือหมดอายุ
            </span>
          </span>
        </label>
        <CardFooter variant="split">
          <Notice tone="success">{save.isSuccess ? "บันทึกแล้ว" : null}</Notice>
          <Button
            type="button"
            wrap
            disabled={!changed || save.isPending}
            onClick={() => {
              save.mutate({
                ...(settingsChanged !== settingsData.settingsChangedEnabled
                  ? { settingsChangedEnabled: settingsChanged }
                  : {}),
                ...(monitorAlerts !== settingsData.monitorAlertsEnabled
                  ? { monitorAlertsEnabled: monitorAlerts }
                  : {}),
                expectedVersion: settingsData.version,
              });
            }}
          >
            {save.isPending ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
          </Button>
        </CardFooter>
      </Card>
    </Page>
  );
}
