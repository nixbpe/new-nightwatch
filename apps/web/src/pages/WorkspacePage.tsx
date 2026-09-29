import { useNavigate } from "react-router";

import { EmptyState } from "../components/shell/EmptyState";
import { GridIcon } from "../components/shell/icons";
import { Page, PageHeader } from "../components/shell/Page";
import { Skeleton } from "../components/shell/Skeleton";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { ROLE_LABELS } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";
import { Card } from "../components/ui/card";

export function WorkspacePage() {
  const { me, mePending, meError, retryMe, activeOrg } = useTenant();

  if (mePending) {
    return (
      <Page>
        <Card role="status" padding="md">
          <span className="sr-only">กำลังโหลดข้อมูลองค์กร…</span>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </Card>
      </Page>
    );
  }

  if (me === undefined) {
    // A failed request is never "zero memberships"; offer an explicit retry.
    return (
      <Page>
        <Card as="section" padding="md">
          <h1 className="text-xl font-semibold">โหลดข้อมูลองค์กรไม่สำเร็จ</h1>
          <Alert tone="error">
            {meError?.message ||
              "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"}
          </Alert>
          <div>
            <Button
              type="button"
              onClick={() => {
                void retryMe();
              }}
            >
              ลองใหม่
            </Button>
          </div>
        </Card>
      </Page>
    );
  }

  if (activeOrg === null) {
    return <AccessNeeded email={me.user.email} />;
  }

  return (
    <Page>
      <PageHeader
        scope={{
          mark: activeOrg.name,
          label: activeOrg.name,
          tag: ROLE_LABELS[activeOrg.role] ?? activeOrg.role,
        }}
        title="ภาพรวม"
        // Names are not unique across organizations, so the slug stays visible.
        status={
          <span>
            slug <span className="font-mono">{activeOrg.slug}</span>
          </span>
        }
      />
      <EmptyState
        icon={<GridIcon size={20} />}
        title="ยังไม่มีข้อมูลการสแกน"
        description="ข้อมูลการตรวจสอบและสถานะระบบขององค์กรนี้จะปรากฏที่นี่เมื่อเปิดใช้งานโมดูลการสแกน"
      />
    </Page>
  );
}

function AccessNeeded({ email }: { email: string }) {
  const navigate = useNavigate();
  return (
    <Page>
      <Card as="section" padding="md">
        <div>
          <h1 className="text-xl font-semibold">
            ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร
          </h1>
          <p className="mt-2 text-sm text-foreground-secondary">
            บัญชี {email} ยังไม่เป็นสมาชิกขององค์กรใด
            การเข้าถึงต้องได้รับคำเชิญจากผู้ดูแลองค์กร หากคุณเพิ่งรับคำเชิญ
            กรุณาเปิดลิงก์จากอีเมลอีกครั้งหลังเข้าสู่ระบบ
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    void navigate("/login", { replace: true });
                  },
                },
              });
            }}
          >
            ออกจากระบบ
          </Button>
        </div>
      </Card>
    </Page>
  );
}
