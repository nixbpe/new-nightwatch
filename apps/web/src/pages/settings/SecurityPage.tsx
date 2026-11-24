import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PageState } from "../../components/shell/PageState";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { contextQueryOptions } from "../../lib/tenant/bootstrap";
import { MfaCard } from "./MfaCard";
import { PasswordCard } from "./PasswordCard";
import { Card, CardSection } from "../../components/ui/card";
import { MockupFrame } from "../../components/ui/mockup-frame";

export function SecurityPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    ...contextQueryOptions(queryClient),
    refetchOnMount: false,
  });

  if (meQuery.isPending) {
    return (
      <PageState
        kind="loading"
        layout="lines"
        data-testid="security-loading"
        label="กำลังโหลดข้อมูลความปลอดภัย…"
      />
    );
  }

  const refreshStatus = async (): Promise<boolean | undefined> => {
    const refreshed = await meQuery.refetch();
    return refreshed.data?.user.twoFactorEnabled;
  };

  // Only the MFA card needs `me`; the password card works without it, so it stays usable.
  return (
    <div className="flex flex-col gap-6">
      <Card className="divide-y divide-foreground/10">
        {meQuery.isError ? (
          <CardSection as="div">
            <Alert data-testid="security-load-error" tone="error">
              ไม่สามารถตรวจสอบสถานะยืนยันสองขั้นตอนได้ กรุณาลองใหม่อีกครั้ง
            </Alert>
            <div>
              <Button
                type="button"
                variant="secondary"
                data-testid="security-load-retry"
                disabled={meQuery.isRefetching}
                onClick={() => {
                  void meQuery.refetch();
                }}
              >
                {meQuery.isRefetching ? "กำลังโหลด…" : "ลองใหม่"}
              </Button>
            </div>
          </CardSection>
        ) : (
          <MfaCard
            enabled={meQuery.data.user.twoFactorEnabled}
            refreshStatus={refreshStatus}
            accountEmail={meQuery.data.user.email}
          />
        )}
        <PasswordCard />
      </Card>
      <AccountSecurityMockup />
    </div>
  );
}

// Placeholder values only: none of these fields exist in the API yet (issue 64).
function AccountSecurityMockup() {
  return (
    <MockupFrame
      testId="security-mockup"
      label="ข้อมูลความปลอดภัยของบัญชี"
      issue={64}
    >
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-foreground-secondary">เปลี่ยนล่าสุด</dt>
          <dd className="font-mono text-xs">--</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-foreground-secondary">ความแข็งแรงของรหัสผ่าน</dt>
          <dd className="flex items-center gap-2">
            <span aria-hidden="true" className="flex gap-1">
              {[0, 1, 2, 3].map((bar) => (
                <i
                  key={bar}
                  className={`h-1 w-6 rounded-full ${bar < 3 ? "bg-foreground" : "bg-foreground/20"}`}
                />
              ))}
            </span>
            <span className="text-xs">ความแข็งแรง: ดี</span>
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-foreground-secondary">
            แอปยืนยันตัวตน{" "}
            <span className="text-xs">
              <span className="font-mono">TOTP</span> · ตั้งค่าเมื่อ{" "}
              <span className="font-mono">--</span>
            </span>
          </dt>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-foreground-secondary">
            รหัสกู้คืน เหลือ <span className="font-mono">N / 10</span> ชุด
          </dt>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-foreground-secondary">
            เซสชันที่เข้าสู่ระบบอยู่
          </dt>
          <dd className="text-xs">
            <span className="font-mono">N</span> · ล่าสุด{" "}
            <span className="font-mono">--</span>
          </dd>
        </div>
      </dl>
    </MockupFrame>
  );
}
