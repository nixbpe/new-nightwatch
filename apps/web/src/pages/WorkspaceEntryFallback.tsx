import { useRef } from "react";
import { useNavigate, useRevalidator } from "react-router";

import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { ROLE_LABELS } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";
import { useFocusHeadingAfterSelfLeave } from "./organization-members/SelfLeaveAction";

export function WorkspaceEntryFallback() {
  const { me, mePending, meError, retryMe, activeOrg } = useTenant();
  const revalidator = useRevalidator();
  if (mePending || revalidator.state === "loading") {
    return (
      <Page>
        <PageHeader title="ภาพรวม" />
        <PageState
          data-testid="workspace-context-loading"
          kind="loading"
          label="กำลังเปิดพื้นที่ทำงาน…"
        />
      </Page>
    );
  }
  if (me === undefined) {
    return (
      <Page>
        <PageHeader title="โหลดข้อมูลองค์กรไม่สำเร็จ" />
        <PageState
          data-testid="workspace-context-error"
          alertTestId="workspace-context-alert"
          retryTestId="workspace-context-retry"
          kind="error"
          message={
            meError?.message ||
            "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"
          }
          retryLabel="ลองใหม่"
          onRetry={() => {
            void retryMe().finally(() => {
              void revalidator.revalidate();
            });
          }}
        />
      </Page>
    );
  }
  if (activeOrg === null) return <AccessNeeded email={me.user.email} />;
  return (
    <Page>
      <PageHeader
        eyebrow="// overview"
        title="ภาพรวม"
        scope={{
          mark: activeOrg.name,
          label: activeOrg.name,
          tag: ROLE_LABELS[activeOrg.role] ?? activeOrg.role,
        }}
        status={
          <span
            data-testid="workspace-identity"
            data-organization-id={activeOrg.id}
            data-member-role={activeOrg.role}
          >
            slug{" "}
            <span data-testid="workspace-slug" className="font-mono">
              {activeOrg.slug}
            </span>
          </span>
        }
      />
      <PageState
        data-testid="workspace-entry-error"
        retryTestId="workspace-entry-retry"
        kind="error"
        message="เปิดพื้นที่ทำงานไม่สำเร็จ"
        retryLabel="ลองใหม่"
        onRetry={() => void revalidator.revalidate()}
      />
    </Page>
  );
}

function AccessNeeded({ email }: { email: string }) {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusHeadingAfterSelfLeave(headingRef);
  return (
    <Page>
      <PageHeader
        title="ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร"
        titleRef={headingRef}
        titleTabIndex={-1}
        titleClassName="outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      <PageState
        data-testid="workspace-access-needed"
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
            data-testid="workspace-sign-out"
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
