// P-05, AC-09: shown on the list and, later, in the export dialog.
export function RecordingScopeNote({ since }: { since?: string }) {
  return (
    <p className="rounded-md border border-foreground/15 bg-foreground/4 px-3 py-2 text-sm text-foreground">
      บันทึกเฉพาะการกระทำที่สำเร็จในหมวด มอนิเตอร์ ตั้งค่าการแจ้งเตือน สมาชิก
      คำเชิญ และบันทึกกิจกรรม
      {since === undefined ? null : (
        <>
          {" "}
          ตั้งแต่ <span className="font-mono">{since}</span>
        </>
      )}{" "}
      ไม่รวมการกระทำที่ถูกปฏิเสธ การตอบรับคำเชิญ (สมาชิกเข้าร่วม)
      กิจกรรมระดับบัญชี (เข้าสู่ระบบ รหัสผ่าน MFA) และกิจกรรมของ AWS account,
      API key และ findings
    </p>
  );
}
