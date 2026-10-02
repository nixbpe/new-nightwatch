import { useQuery } from "@tanstack/react-query";

import {
  fetchOrganizationNotificationSettings,
  organizationNotificationSettingsQueryKey,
} from "../../../lib/api/notifications";
import { Card } from "../../../components/ui/card";
import { MockupFrame } from "../../../components/ui/mockup-frame";
import { SectionHeader } from "../../../components/ui/section-header";

const CHECKBOX_CARD =
  "flex items-start gap-3 rounded-md border border-foreground/10 px-4 py-3 text-sm";

/**
 * Alerts step. Down, recovery and SSL expiry notifications are org
 * notifications gated by the org setting monitorAlertsEnabled (worker
 * notifications.ts), so the note reuses the org settings string and shows only
 * while that setting is on. Unknown, failed or off hides it.
 * The per-monitor toggles and the failure threshold are not in the contract
 * yet, so they are sample controls inside a mockup frame (issue 60): disabled,
 * unnamed and outside the form values.
 */
export function AlertsSection({
  code,
  organizationId,
}: {
  code: string;
  organizationId: string;
}) {
  const settings = useQuery({
    queryKey: organizationNotificationSettingsQueryKey(organizationId),
    queryFn: () => fetchOrganizationNotificationSettings(organizationId),
  });
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
      <MockupFrame label="ตั้งค่าการแจ้งเตือนต่อมอนิเตอร์" issue={60}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            แจ้งเมื่อล้มเหลวติดกัน
            <select
              disabled
              defaultValue="2"
              className="h-10 max-w-48 rounded-md border border-control-border bg-transparent px-3 font-sans text-sm opacity-60"
            >
              <option value="1">1 ครั้ง</option>
              <option value="2">2 ครั้ง</option>
              <option value="3">3 ครั้ง</option>
            </select>
          </label>
          <label className={CHECKBOX_CARD}>
            <input type="checkbox" disabled defaultChecked className="mt-0.5" />
            <span className="font-medium">แจ้งเมื่อล่มและกลับมาปกติ</span>
          </label>
          <label className={CHECKBOX_CARD}>
            <input type="checkbox" disabled defaultChecked className="mt-0.5" />
            <span className="font-medium">แจ้งเมื่อ SSL ใกล้หมดอายุ</span>
          </label>
        </div>
      </MockupFrame>
    </Card>
  );
}
