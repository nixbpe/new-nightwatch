import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

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
  if (settings.isPending) return <div role="status">กำลังโหลดการตั้งค่า…</div>;
  if (settings.isError)
    return (
      <Alert tone="error">
        {settings.error instanceof ApiError &&
        ["PERMISSION_DENIED", "MEMBERSHIP_DENIED"].includes(settings.error.code)
          ? "คุณไม่มีสิทธิ์จัดการการตั้งค่านี้"
          : "โหลดการตั้งค่าไม่สำเร็จ"}
      </Alert>
    );
  const settingsData = settings.data;
  const value = enabled ?? settingsData.settingsChangedEnabled;
  return (
    <section className="max-w-xl rounded-md border border-foreground/10 bg-surface p-6">
      <p className="text-sm text-foreground-secondary">การตั้งค่าองค์กร</p>
      <h1 className="mt-1 text-2xl font-semibold">การแจ้งเตือน</h1>
      {save.isError ? (
        <Alert tone="error">
          {save.error instanceof ApiError &&
          save.error.code === "SETTINGS_VERSION_CONFLICT"
            ? "การตั้งค่าถูกเปลี่ยนโดยผู้อื่น กรุณาโหลดใหม่"
            : "บันทึกการตั้งค่าไม่สำเร็จ"}
        </Alert>
      ) : null}
      <label className="mt-6 flex items-start gap-3">
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
            Owner และ Admin คนอื่นจะได้รับการแจ้งเตือนเมื่อมีการเปลี่ยนแปลง
          </span>
        </span>
      </label>
      <div className="mt-6 flex justify-end">
        <Button
          className="h-auto min-h-9 w-full max-w-full break-words whitespace-normal sm:w-auto"
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
  );
}
