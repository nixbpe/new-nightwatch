import { useQuery } from "@tanstack/react-query";

import {
  fetchOrganizationNotificationSettings,
  organizationNotificationSettingsQueryKey,
} from "../../../lib/api/notifications";
import { Card } from "../../../components/ui/card";
import { SectionHeader } from "../../../components/ui/section-header";
import { ORG_ALERTS_OFF_MESSAGE } from "../detail/labels";
import { SelectControl, TextControl, type SectionProps } from "./controls";

const CHECKBOX_CARD =
  "flex items-start gap-3 rounded-md border border-foreground/10 px-4 py-3 text-sm";

const FAILURE_THRESHOLD_HINT =
  "ค่านี้ใช้ตัดสินว่ามอนิเตอร์ล่มด้วย แม้ปิด 'แจ้งเมื่อล่มและกลับมาปกติ'";
const SSL_DAYS_DISABLED_HINT =
  "เปิด 'แจ้งเมื่อ SSL ใกล้หมดอายุ' ก่อน จึงจะแก้จำนวนวันนี้ได้";

export function AlertsSection({
  code,
  organizationId,
  values,
  errors,
  onChange,
  disabled,
}: SectionProps & {
  code: string;
  organizationId: string;
}) {
  const settings = useQuery({
    queryKey: organizationNotificationSettingsQueryKey(organizationId),
    queryFn: () => fetchOrganizationNotificationSettings(organizationId),
  });
  const alerts = values.alerts;
  return (
    <Card as="section" aria-labelledby="monitor-form-alerts" padding="md">
      <SectionHeader
        id="monitor-form-alerts"
        code={code}
        title="การแจ้งเตือน"
      />
      {settings.data?.monitorAlertsEnabled === true ? (
        <p className="text-sm text-foreground-secondary">
          เจ้าของและผู้ดูแลจะได้รับการแจ้งเตือนเมื่อมอนิเตอร์ล่ม
          กลับมาทำงานหลังจากที่แจ้งว่าล่มแล้ว และเมื่อใบรับรอง SSL
          ใกล้หมดอายุหรือหมดอายุ
        </p>
      ) : null}
      {settings.data?.monitorAlertsEnabled === false ? (
        <p role="status" className="text-sm text-foreground-secondary">
          {ORG_ALERTS_OFF_MESSAGE}
        </p>
      ) : null}
      <SelectControl
        path="alerts.failureThreshold"
        label="แจ้งเมื่อล้มเหลวติดกัน"
        value={String(alerts.failureThreshold)}
        error={errors["alerts.failureThreshold"]}
        disabled={disabled}
        hint={FAILURE_THRESHOLD_HINT}
        className="max-w-48"
        onChange={(event) => {
          onChange(
            {
              alerts: {
                ...alerts,
                failureThreshold: Number(event.target.value),
              },
            },
            "alerts.failureThreshold",
          );
        }}
      >
        <option value="1">1 ครั้ง</option>
        <option value="2">2 ครั้ง</option>
        <option value="3">3 ครั้ง</option>
      </SelectControl>
      <label className={CHECKBOX_CARD}>
        <input
          type="checkbox"
          checked={alerts.downEnabled}
          aria-disabled={disabled}
          className="mt-0.5 h-4 w-4 accent-primary"
          onChange={(event) => {
            if (disabled) return;
            onChange(
              { alerts: { ...alerts, downEnabled: event.target.checked } },
              "alerts.downEnabled",
            );
          }}
        />
        <span className="font-medium">แจ้งเมื่อล่มและกลับมาปกติ</span>
      </label>
      <label className={CHECKBOX_CARD}>
        <input
          type="checkbox"
          checked={alerts.sslEnabled}
          aria-disabled={disabled}
          className="mt-0.5 h-4 w-4 accent-primary"
          onChange={(event) => {
            if (disabled) return;
            onChange(
              { alerts: { ...alerts, sslEnabled: event.target.checked } },
              "alerts.sslEnabled",
            );
          }}
        />
        <span className="font-medium">แจ้งเมื่อ SSL ใกล้หมดอายุ</span>
      </label>
      <TextControl
        path="alerts.sslCautionDays"
        label="แจ้งล่วงหน้าก่อนหมดอายุ (วัน)"
        inputMode="numeric"
        value={alerts.sslCautionDays}
        error={errors["alerts.sslCautionDays"]}
        disabled={disabled || !alerts.sslEnabled}
        hint={alerts.sslEnabled ? undefined : SSL_DAYS_DISABLED_HINT}
        className="max-w-40"
        onChange={(event) => {
          onChange(
            { alerts: { ...alerts, sslCautionDays: event.target.value } },
            "alerts.sslCautionDays",
          );
        }}
      />
    </Card>
  );
}
