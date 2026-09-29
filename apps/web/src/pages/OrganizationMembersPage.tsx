import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { Notice } from "../components/ui/notice";
import { DataTable, DataTablePagination } from "../components/ui/data-table";
import { StatusPill } from "../components/ui/status-pill";
import { ROLE_LABELS } from "../lib/roles";
import { Page, PageHeader } from "../components/shell/Page";
import { PageState } from "../components/shell/PageState";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../lib/api/members";
import { useTenant } from "../lib/tenant/TenantProvider";
import { InvitationPanel } from "./organization-members/InvitationPanel";
import { MemberActionDialog } from "./organization-members/MemberActionDialog";
import {
  MemberRoleActions,
  useMemberRoleChange,
} from "./organization-members/MemberRoleActions";

const LIMIT = 50;

function isMemberDirectoryReadable({ role }: { role: string }): boolean {
  return role === "owner" || role === "admin";
}

function isAuthorizationDenied(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "MEMBERSHIP_DENIED" || error.code === "PERMISSION_DENIED")
  );
}

export function OrganizationMembersPage() {
  const { organizationId } = useParams();
  if (organizationId === undefined) return null;
  return (
    <OrganizationMembersPageForOrganization
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

function OrganizationMembersPageForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const { me, meError, mePending, refreshMembershipContext } = useTenant();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [membershipRefreshState, setMembershipRefreshState] = useState<
    "idle" | "refreshing" | "failed" | "list-failed"
  >("idle");
  const membershipRecoveryOperation = useRef(0);
  const [offset, setOffset] = useState(0);
  const memberPageHeadingRef = useRef<HTMLHeadingElement>(null);
  const organization = me?.organizations.find(
    (item) => item.id === organizationId,
  );
  const canRead =
    organization !== undefined && isMemberDirectoryReadable(organization);
  const list = useQuery({
    queryKey: memberListQueryKey(organizationId, LIMIT, offset),
    queryFn: () => fetchOrganizationMembers(organizationId, LIMIT, offset),
    enabled: canRead,
  });
  const { refetch: refetchList } = list;
  const actorRole = organization?.role === "owner" ? "owner" : "admin";
  const roleChange = useMemberRoleChange({
    organizationId,
    actorRole,
    actorUserId: me?.user.id,
    listSettled: !list.isFetching && list.data !== undefined,
    headingRef: memberPageHeadingRef,
    refetchList,
    refreshMembershipContext,
  });

  const recoverAfterBoundedRefetchDenial = useCallback(async () => {
    const operation = membershipRecoveryOperation.current + 1;
    membershipRecoveryOperation.current = operation;
    setMembershipRefreshState("refreshing");
    const context = await refreshMembershipContext();
    if (membershipRecoveryOperation.current !== operation) return;
    if (context === null) {
      setMembershipRefreshState("failed");
      return;
    }
    const sameOrganizationIsReadable = context.organizations.some(
      (organization) =>
        organization.id === organizationId &&
        isMemberDirectoryReadable(organization),
    );
    if (sameOrganizationIsReadable) {
      setMembershipRefreshState("failed");
      return;
    }
    const nextOrganizationId =
      context.organizations.find(
        (organization) =>
          organization.id === context.lastActiveTenantId &&
          isMemberDirectoryReadable(organization),
      )?.id ?? context.organizations.find(isMemberDirectoryReadable)?.id;
    await navigate(
      nextOrganizationId === undefined
        ? "/workspace"
        : `/organizations/${nextOrganizationId}/members`,
      { replace: true },
    );
  }, [navigate, organizationId, refreshMembershipContext]);

  const refreshAfterAuthorizationDenied = useCallback(async () => {
    const operation = membershipRecoveryOperation.current + 1;
    membershipRecoveryOperation.current = operation;
    setMembershipRefreshState("refreshing");
    const context = await refreshMembershipContext();
    if (membershipRecoveryOperation.current !== operation) return;
    if (context === null) {
      setMembershipRefreshState("failed");
      return;
    }
    const sameOrganizationIsReadable = context.organizations.some(
      (organization) =>
        organization.id === organizationId &&
        isMemberDirectoryReadable(organization),
    );
    if (sameOrganizationIsReadable) {
      const result = await refetchList();
      if (membershipRecoveryOperation.current !== operation) return;
      if (!result.isError) {
        setMembershipRefreshState("idle");
        return;
      }
      if (isAuthorizationDenied(result.error)) {
        void recoverAfterBoundedRefetchDenial();
        return;
      }
      setMembershipRefreshState("list-failed");
      return;
    }
    const nextOrganizationId =
      context.organizations.find(
        (organization) =>
          organization.id === context.lastActiveTenantId &&
          isMemberDirectoryReadable(organization),
      )?.id ?? context.organizations.find(isMemberDirectoryReadable)?.id;
    await navigate(
      nextOrganizationId === undefined
        ? "/workspace"
        : `/organizations/${nextOrganizationId}/members`,
      { replace: true },
    );
  }, [
    navigate,
    organizationId,
    recoverAfterBoundedRefetchDenial,
    refetchList,
    refreshMembershipContext,
  ]);

  const retryAfterListFailure = useCallback(async () => {
    const operation = membershipRecoveryOperation.current + 1;
    membershipRecoveryOperation.current = operation;
    const result = await refetchList();
    if (membershipRecoveryOperation.current !== operation) return;
    if (!result.isError) {
      setMembershipRefreshState("idle");
      return;
    }
    if (isAuthorizationDenied(result.error)) {
      void refreshAfterAuthorizationDenied();
    }
  }, [refetchList, refreshAfterAuthorizationDenied]);

  useEffect(() => {
    return () => {
      membershipRecoveryOperation.current += 1;
    };
  }, [organizationId]);

  useEffect(() => {
    if (
      !isAuthorizationDenied(list.error) ||
      membershipRefreshState !== "idle"
    ) {
      return;
    }
    void refreshAfterAuthorizationDenied();
  }, [list.error, membershipRefreshState, refreshAfterAuthorizationDenied]);
  const invalidPage =
    list.data?.organizationId === organizationId &&
    offset > 0 &&
    list.data.page.total <= offset;
  useEffect(() => {
    if (!invalidPage) {
      return;
    }
    queryClient.removeQueries({
      queryKey: memberListQueryKey(organizationId, LIMIT, 0),
      exact: true,
    });
    setOffset(0);
  }, [invalidPage, organizationId, queryClient]);
  if (
    membershipRefreshState === "refreshing" ||
    (isAuthorizationDenied(list.error) && membershipRefreshState === "idle")
  ) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState
          kind="loading"
          label="กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก"
          layout="table"
          visibleLabel
        />
      </Page>
    );
  }
  if (membershipRefreshState === "failed") {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshAfterAuthorizationDenied()}
        />
      </Page>
    );
  }
  if (mePending) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState kind="loading" label="กำลังโหลดสมาชิก" layout="table" />
      </Page>
    );
  }
  if (meError !== null) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={() => void refreshMembershipContext()}
        />
      </Page>
    );
  }
  if (organization === undefined || !canRead) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState
          kind="denied"
          message="คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้"
        />
      </Page>
    );
  }
  let directory: ReactNode;
  if (list.isFetching || invalidPage) {
    directory = (
      <PageState
        kind="loading"
        label="กำลังโหลดสมาชิก"
        layout="table"
        rows={5}
      />
    );
  } else if (list.isError || membershipRefreshState === "list-failed") {
    directory = (
      <PageState
        kind="error"
        message="โหลดสมาชิกไม่สำเร็จ"
        retryLabel="ลองอีกครั้ง"
        onRetry={() => void retryAfterListFailure()}
        actions={
          offset > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                memberPageHeadingRef.current?.focus();
                setOffset((value) => Math.max(0, value - LIMIT));
              }}
            >
              ก่อนหน้า
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    const data = list.data;
    if (data === undefined || data.organizationId !== organizationId)
      return null;
    const hasPrevious = offset > 0;
    const hasNext = offset + data.members.length < data.page.total;
    directory = (
      <>
        <DataTable
          ariaLabel="ตารางสมาชิก"
          columns={[
            { key: "name", header: "ชื่อ", width: "30%", cell: (m) => m.name },
            { key: "email", header: "อีเมล", cell: (m) => m.email },
            {
              key: "role",
              header: "บทบาท",
              width: "160px",
              cell: (m) => (
                <StatusPill>{ROLE_LABELS[m.role] ?? m.role}</StatusPill>
              ),
            },
            {
              key: "change-role",
              header: "เปลี่ยนบทบาท",
              align: "end",
              cell: (m) =>
                roleChange.scopeCurrent ? (
                  <MemberRoleActions
                    key={`${m.id}:${m.role}:${actorRole}`}
                    member={m}
                    actorRole={actorRole}
                    pending={roleChange.pending}
                    onSave={roleChange.request}
                  />
                ) : null,
            },
          ]}
          rows={data.members}
          rowKey={(m) => m.id}
          empty={`สมาชิกทั้งหมด ${String(data.page.total)} คน`}
        />
        <DataTablePagination
          ariaLabel="หน้าสมาชิก"
          summary={
            <>
              แสดง {data.members.length === 0 ? 0 : offset + 1}–
              {offset + data.members.length} จาก {data.page.total}
            </>
          }
          previousLabel="ก่อนหน้า"
          nextLabel="ถัดไป"
          hasPrevious={hasPrevious && !roleChange.pending}
          hasNext={hasNext && !roleChange.pending}
          onPrevious={() => {
            setOffset((value) => Math.max(0, value - LIMIT));
          }}
          onNext={() => {
            setOffset((value) => value + LIMIT);
          }}
        />
      </>
    );
  }
  return (
    <Page>
      <PageHeader
        scope={{ mark: organization.name, label: organization.name }}
        title="สมาชิก"
        status={
          <>
            <span>
              slug <span className="font-mono">{organization.slug}</span>
            </span>
            {!list.isFetching && !list.isError && !invalidPage && list.data ? (
              <span>{`สมาชิกทั้งหมด ${String(list.data.page.total)} คน`}</span>
            ) : null}
          </>
        }
        titleRef={memberPageHeadingRef}
        titleTabIndex={-1}
        titleClassName="focus:outline-2 focus:outline-offset-2 focus:outline-primary"
      />
      <InvitationPanel
        key={organization.role}
        organizationId={organizationId}
        organizationName={organization.name}
        actorRole={organization.role === "owner" ? "owner" : "admin"}
      />
      {roleChange.scopeCurrent && roleChange.pending ? (
        <Notice tone="pending">กำลังบันทึกบทบาท…</Notice>
      ) : null}
      {roleChange.scopeCurrent && roleChange.notice !== null ? (
        roleChange.notice.tone === "success" ? (
          <Notice tone="success">{roleChange.notice.text}</Notice>
        ) : (
          <Alert tone="error">{roleChange.notice.text}</Alert>
        )
      ) : null}
      {roleChange.scopeCurrent &&
      actorRole === "owner" &&
      roleChange.confirmation !== null ? (
        <MemberActionDialog
          title="ยืนยันการเปลี่ยนบทบาท"
          description={
            <>
              <p>
                เปลี่ยนบทบาทของ {roleChange.confirmation.member.name} (
                {roleChange.confirmation.member.email}) ในองค์กร{" "}
                {organization.name} ({organization.slug}) จาก{" "}
                {ROLE_LABELS[roleChange.confirmation.member.role]} เป็น{" "}
                {ROLE_LABELS[roleChange.confirmation.role]}
              </p>
              <p className="mt-2">
                การเปลี่ยนสิทธิ์เจ้าของมีผลต่อการจัดการสมาชิกและการเข้าถึงองค์กร
                {roleChange.confirmation.member.userId === me?.user.id
                  ? " คุณกำลังเปลี่ยนบทบาทของตัวเอง"
                  : ""}
              </p>
            </>
          }
          confirmLabel="ยืนยันการเปลี่ยนบทบาท"
          pendingLabel="กำลังบันทึกบทบาท…"
          pending={roleChange.pending}
          opener={roleChange.confirmation.opener}
          fallbackFocus={memberPageHeadingRef}
          onCancel={roleChange.cancel}
          onConfirm={roleChange.confirm}
        />
      ) : null}
      {directory}
    </Page>
  );
}
