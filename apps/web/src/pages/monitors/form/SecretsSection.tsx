import { Card, CardHeader } from "../../../components/ui/card";
import { authText } from "../detail/labels";
import type { FormValues } from "./model";

/**
 * Extension point for the secrets section (Task 14): auth type, token, Basic
 * credentials, API key and secret headers. Until then Edit only shows what is
 * set and passes it through unchanged (see `editPayload`, `testEditPayload`),
 * and Create renders nothing because it cannot offer auth or secret headers yet.
 */
export function SecretsSection({
  auth,
  editing,
}: {
  auth: FormValues["auth"];
  editing: boolean;
}) {
  if (!editing || auth.type === "none") return null;
  return (
    <Card as="section" aria-labelledby="monitor-form-auth" padding="md">
      <CardHeader id="monitor-form-auth" title="การยืนยันตัวตน" />
      <p className="text-sm">
        {authText(auth)}{" "}
        <span className="text-foreground-secondary">ตั้งค่าแล้ว</span>
      </p>
      <p className="text-sm text-foreground-secondary">
        ค่าเดิมยังใช้ต่อ การแก้ไขหรือแทนที่ค่าลับจะอยู่ในส่วนค่าลับ
        (ยังไม่เปิดใช้)
      </p>
    </Card>
  );
}
