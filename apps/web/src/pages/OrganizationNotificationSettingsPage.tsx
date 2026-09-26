import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { Page, PageHeader } from "../components/shell/Page";
import { Skeleton } from "../components/shell/Skeleton";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationNotificationSettings,
  organizationNotificationSettingsQueryKey,
  updateOrganizationNotificationSettings,
} from "../lib/api/notifications";

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
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const settingsQueryKey =
    organizationNotificationSettingsQueryKey(organizationId);
  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => fetchOrganizationNotificationSettings(organizationId),
  });
  const save = useMutation({
    mutationFn: ({
      value,
      expectedVersion,
    }: {
      value: boolean;
      expectedVersion: number;
    }) =>
      updateOrganizationNotificationSettings(organizationId, {
        settingsChangedEnabled: value,
        expectedVersion,
      }),
    onSuccess: async () => {
      setEnabled(null);
      await client.invalidateQueries({
        queryKey: settingsQueryKey,
      });
    },
  });
  const header = (
    <PageHeader
      eyebrow="ตั้งค่าองค์กร"
      title="ตั้งค่าการแจ้งเตือน"
      description="ใช้กับสมาชิกทุกคนขององค์กรที่เลือกอยู่"
    />
  );
  if (settings.isPending)
    return (
      <Page>
        {header}
        <div
          role="status"
          className="flex flex-col gap-4 rounded-md border border-foreground/10 bg-surface p-6"
        >
          <span className="sr-only">กำลังโหลดการตั้งค่า…</span>
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      </Page>
    );
  if (settings.isError)
    return (
      <Page>
        {header}
        <Alert tone="error">
          {settings.error instanceof ApiError &&
          ["PERMISSION_DENIED", "MEMBERSHIP_DENIED"].includes(
            settings.error.code,
          )
            ? "คุณไม่มีสิทธิ์จัดการการตั้งค่านี้"
            : "โหลดการตั้งค่าไม่สำเร็จ"}
        </Alert>
      </Page>
    );
  const settingsData = settings.data;
  const value = enabled ?? settingsData.settingsChangedEnabled;
  return (
    <Page>
      {header}
      <section className="flex flex-col gap-5 rounded-md border border-foreground/10 bg-surface p-6">
        {save.isError ? (
          <Alert tone="error">
            {save.error instanceof ApiError &&
            save.error.code === "SETTINGS_VERSION_CONFLICT"
              ? "การตั้งค่าถูกเปลี่ยนโดยผู้อื่น กรุณาโหลดใหม่"
              : "บันทึกการตั้งค่าไม่สำเร็จ"}
          </Alert>
        ) : null}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={value}
            onChange={(event) => {
              setEnabled(event.target.checked);
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
        <div className="flex justify-end border-t border-foreground/10 pt-4">
          <Button
            className="h-auto min-h-10 w-full max-w-full break-words whitespace-normal sm:w-auto"
            disabled={
              value === settingsData.settingsChangedEnabled || save.isPending
            }
            onClick={() => {
              save.mutate({ value, expectedVersion: settingsData.version });
            }}
          >
            บันทึกการเปลี่ยนแปลง
          </Button>
        </div>
      </section>
    </Page>
  );
}
