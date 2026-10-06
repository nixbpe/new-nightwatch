import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { contextQueryOptions } from "../../lib/tenant/bootstrap";
import { MfaCard } from "./MfaCard";
import { PasswordCard } from "./PasswordCard";
import { Card } from "../../components/ui/card";
import { MockupFrame } from "../../components/ui/mockup-frame";

// The server's twoFactorEnabled flag is the only source of the card's enabled state.
export function SecurityPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    ...contextQueryOptions(queryClient),
    refetchOnMount: false,
  });

  if (meQuery.isPending) {
    return (
      <Card role="status" aria-label="กำลังโหลดข้อมูลความปลอดภัย" padding="md">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full max-w-lg" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">
          ไม่สามารถตรวจสอบสถานะยืนยันสองขั้นตอนได้ กรุณาลองใหม่อีกครั้ง
        </Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={meQuery.isRefetching}
            onClick={() => {
              void meQuery.refetch();
            }}
          >
            {meQuery.isRefetching ? "กำลังโหลด…" : "ลองใหม่"}
          </Button>
        </div>
      </div>
    );
  }

  // Refetching the shared me/context query also updates the shell's account block, which reads the same cache.
  const refreshStatus = async (): Promise<boolean | undefined> => {
    const refreshed = await meQuery.refetch();
    return refreshed.data?.user.twoFactorEnabled;
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <MfaCard
          enabled={meQuery.data.user.twoFactorEnabled}
          refreshStatus={refreshStatus}
        />
      </Card>
      <Card>
        <PasswordCard />
      </Card>
      <AccountSecurityMockup />
    </div>
  );
}

// Placeholder values only: none of these fields exist in the API yet (issue 64).
function AccountSecurityMockup() {
  return (
    <MockupFrame label="ข้อมูลความปลอดภัยของบัญชี" issue={64}>
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
          <dd>
            <Button type="button" variant="secondary" size="sm" disabled>
              ตั้งค่าใหม่
            </Button>
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-foreground-secondary">
            รหัสกู้คืน เหลือ <span className="font-mono">N / 10</span> ชุด
          </dt>
          <dd>
            <Button type="button" variant="secondary" size="sm" disabled>
              สร้างรหัสใหม่
            </Button>
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-foreground-secondary">
            อุปกรณ์ที่เข้าสู่ระบบอยู่
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
