import { useNavigate } from "react-router";

import { EmptyState } from "../components/shell/EmptyState";
import { GridIcon } from "../components/shell/icons";
import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { ROLE_LABELS } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";

export function WorkspacePage() {
  const { me, mePending, meError, retryMe, activeOrg } = useTenant();

  if (mePending) {
    return (
      <Page>
        <PageHeader title="ภาพรวม" />
        <PageState kind="loading" label="กำลังโหลดข้อมูลองค์กร…" />
      </Page>
    );
  }

  if (me === undefined) {
    // A failed request is never "zero memberships"; offer an explicit retry.
    return (
      <Page>
        <PageHeader title="โหลดข้อมูลองค์กรไม่สำเร็จ" />
        <PageState
          kind="error"
          message={
            meError?.message ||
            "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"
          }
          retryLabel="ลองใหม่"
          onRetry={() => {
            void retryMe();
          }}
        />
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
        variant="first-run"
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
      <PageHeader title="ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร" />
      <PageState
        kind="denied"
        tone="info"
        message={
          <>
            บัญชี {email} ยังไม่เป็นสมาชิกขององค์กรใด
            การเข้าถึงต้องได้รับคำเชิญจากผู้ดูแลองค์กร หากคุณเพิ่งรับคำเชิญ
            กรุณาเปิดลิงก์จากอีเมลอีกครั้งหลังเข้าสู่ระบบ
          </>
        }
        action={
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
        }
      />
    </Page>
  );
}
