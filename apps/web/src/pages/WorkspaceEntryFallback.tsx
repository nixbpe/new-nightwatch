import { useRef } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";

import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { ROLE_LABELS } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";
import { useFocusHeadingAfterSelfLeave } from "./organization-members/SelfLeaveAction";

export function WorkspaceEntryFallback() {
  const { me, mePending, retryMe, activeOrg, switchOrg } = useTenant();
  const revalidator = useRevalidator();
  if (mePending || revalidator.state === "loading") {
    return (
      <Page>
        <PageHeader title="พื้นที่ทำงาน" />
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
          message="เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง"
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
  if (activeOrg === null) {
    const refresh = () => {
      void retryMe().finally(() => {
        void revalidator.revalidate();
      });
    };
    return (
      <AccessNeeded
        email={me.user.email}
        organizations={me.organizations}
        onRefresh={refresh}
        onChoose={(organizationId) => {
          void switchOrg(organizationId).then((switched) => {
            if (switched) void revalidator.revalidate();
          });
        }}
      />
    );
  }
  return (
    <Page>
      <PageHeader
        title="เปิดพื้นที่ทำงานไม่สำเร็จ"
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
        actions={
          <Button asChild variant="secondary">
            <Link
              data-testid="workspace-entry-projects"
              to={`/organizations/${activeOrg.id}/projects`}
            >
              ไปรายการโปรเจกต์
            </Link>
          </Button>
        }
      />
    </Page>
  );
}

// Two different dead ends: no membership at all, or memberships but none selected (the remembered
// Organization was revoked). Only the first one needs an invitation.
function AccessNeeded({
  email,
  organizations,
  onRefresh,
  onChoose,
}: {
  email: string;
  organizations: ReadonlyArray<{ id: string; name: string; role: string }>;
  onRefresh: () => void;
  onChoose: (organizationId: string) => void;
}) {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusHeadingAfterSelfLeave(headingRef);
  const signOut = (
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
  );
  const choose = organizations.length > 0;
  return (
    <Page>
      <PageHeader
        title={choose ? "เลือกองค์กร" : "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร"}
        titleRef={headingRef}
        titleTabIndex={-1}
      />
      <PageState
        data-testid={
          choose ? "workspace-org-choice" : "workspace-access-needed"
        }
        kind="denied"
        tone="info"
        message={
          choose ? (
            <>
              บัญชี {email} ยังไม่ได้เลือกองค์กรที่ใช้งาน
              เลือกองค์กรเพื่อเข้าสู่พื้นที่ทำงาน
            </>
          ) : (
            <>
              บัญชี {email} ยังไม่เป็นสมาชิกขององค์กรใด
              การเข้าถึงต้องได้รับคำเชิญจากเจ้าของหรือผู้ดูแลองค์กร
              หากคุณเพิ่งรับคำเชิญ กดลองใหม่หรือเปิดลิงก์จากอีเมลอีกครั้ง
            </>
          )
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {choose ? (
              organizations.map((org) => (
                <Button
                  key={org.id}
                  data-testid="workspace-org-option"
                  data-organization-id={org.id}
                  type="button"
                  wrap
                  onClick={() => {
                    onChoose(org.id);
                  }}
                >
                  {org.name} ({ROLE_LABELS[org.role] ?? org.role})
                </Button>
              ))
            ) : (
              <Button
                data-testid="workspace-access-retry"
                type="button"
                onClick={onRefresh}
              >
                ลองใหม่
              </Button>
            )}
            {signOut}
          </div>
        }
      />
    </Page>
  );
}
