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
import { SectionHeader } from "../components/ui/section-header";
import { MockupFrame } from "../components/ui/mockup-frame";
import { initialsFontClass, initialsOf } from "../components/shell/initials";
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
import { PendingInvitationsSection } from "./organization-members/PendingInvitationsSection";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import {
  MemberRevokeButton,
  useMemberRevoke,
} from "./organization-members/MemberRevokeAction";
import {
  MemberRoleActions,
  useMemberRoleChange,
} from "./organization-members/MemberRoleActions";
import {
  SelfLeaveButton,
  SelfLeaveSection,
  useFocusHeadingAfterSelfLeave,
  useSelfLeave,
} from "./organization-members/SelfLeaveAction";

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
  const [invitationCreations, setInvitationCreations] = useState(0);
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
  const actorRole = organization?.role === "owner" ? "owner" : "admin";
  const roleChange = useMemberRoleChange({
    organizationId,
    actorRole,
    actorUserId: me?.user.id,
    listSettled: !list.isFetching && list.data !== undefined,
    headingRef: memberPageHeadingRef,
    refetchList,
    // Shows loading during the refresh and a retryable error if it fails,
    // instead of the restricted state a hidden context would render.
    refreshMembershipContext: refreshAfterAuthorizationDenied,
  });

  const revoke = useMemberRevoke({
    organizationId,
    listSettled: !list.isFetching && list.data !== undefined,
    headingRef: memberPageHeadingRef,
    refetchList,
    refreshMembershipContext: refreshAfterAuthorizationDenied,
    blocked: roleChange.pending,
  });
  const otherMutationPending = roleChange.pending || revoke.pending;
  const selfLeave = useSelfLeave({
    organizationId,
    blocked: otherMutationPending,
    headingRef: memberPageHeadingRef,
    refreshMembershipContext,
  });
  useFocusHeadingAfterSelfLeave(memberPageHeadingRef);
  const memberMutationPending =
    roleChange.pending || revoke.pending || selfLeave.pending;

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
  if (selfLeave.phase === "refreshing") {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState
          kind="loading"
          label="กำลังยืนยันการออกจากองค์กร"
          layout="table"
          visibleLabel
        />
      </Page>
    );
  }
  if (selfLeave.phase === "refresh-failed") {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <PageState
          kind="error"
          message="ไม่สามารถยืนยันสถานะการเป็นสมาชิกได้"
          retryLabel="ลองอีกครั้ง"
          onRetry={selfLeave.retryRefresh}
        />
      </Page>
    );
  }
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
  if (organization === undefined) {
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
  const selfLeaveAction = (
    <SelfLeaveButton selfLeave={selfLeave} disabled={otherMutationPending} />
  );
  const selfLeaveSection = (
    <SelfLeaveSection
      selfLeave={selfLeave}
      organization={organization}
      actor={me?.user}
      headingRef={memberPageHeadingRef}
    />
  );
  if (!canRead) {
    // Viewer and auditor cannot list members but can still leave.
    return (
      <Page>
        <PageHeader
          eyebrow="// organization · members"
          scope={{
            mark: organization.name,
            label: organization.name,
            tag: ROLE_LABELS[organization.role] ?? organization.role,
          }}
          title="สมาชิก"
          status={
            <span>
              slug <span className="font-mono">{organization.slug}</span>
            </span>
          }
          actions={selfLeaveAction}
          titleRef={memberPageHeadingRef}
          titleTabIndex={-1}
          titleClassName="outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        {selfLeaveSection}
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
            {
              key: "name",
              header: "ชื่อ",
              width: "30%",
              cell: (m) => {
                const initials = initialsOf(m.name);
                return (
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`grid size-8 flex-none place-items-center rounded-full border border-foreground/20 surface-hover text-[11px] font-semibold text-foreground ${initialsFontClass(initials)}`}
                    >
                      {initials}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-heading">{m.name}</span>
                      {m.userId === me?.user.id ? (
                        <span className="text-xs text-foreground-secondary">
                          คุณ
                        </span>
                      ) : null}
                    </span>
                  </span>
                );
              },
            },
            {
              key: "email",
              header: "อีเมล",
              mono: true,
              cell: (m) => (
                <span className="text-foreground-secondary">{m.email}</span>
              ),
            },
            {
              key: "role",
              header: "บทบาท",
              width: "160px",
              cell: (m) => (
                <StatusPill tone={m.role === "owner" ? "primary" : "neutral"}>
                  {ROLE_LABELS[m.role] ?? m.role}
                </StatusPill>
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
                    pending={memberMutationPending}
                    onSave={roleChange.request}
                  />
                ) : null,
            },
            {
              key: "revoke",
              header: "ถอนสมาชิก",
              align: "end",
              cell: (m) =>
                roleChange.scopeCurrent && revoke.scopeCurrent ? (
                  <MemberRevokeButton
                    member={m}
                    actorRole={actorRole}
                    actorUserId={me?.user.id}
                    pending={memberMutationPending}
                    onRevoke={revoke.request}
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
          hasPrevious={hasPrevious && !memberMutationPending}
          hasNext={hasNext && !memberMutationPending}
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
        eyebrow="// organization · members"
        scope={{
          mark: organization.name,
          label: organization.name,
          tag: ROLE_LABELS[organization.role] ?? organization.role,
        }}
        title="สมาชิก"
        actions={selfLeaveAction}
        status={
          <>
            <span>
              slug <span className="font-mono">{organization.slug}</span>
            </span>
            {!list.isFetching && !list.isError && !invalidPage && list.data ? (
              <span>
                สมาชิกทั้งหมด{" "}
                <span className="font-mono">
                  {String(list.data.page.total)}
                </span>{" "}
                คน
              </span>
            ) : null}
          </>
        }
        titleRef={memberPageHeadingRef}
        titleTabIndex={-1}
        titleClassName="outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      {selfLeaveSection}
      <MockupFrame label="เพดานจำนวนสมาชิก" issue={66}>
        <p className="text-sm text-foreground-secondary">
          เพดานสมาชิกต่อองค์กร{" "}
          <span className="font-mono text-foreground">N</span> คน
        </p>
      </MockupFrame>
      <InvitationPanel
        key={organization.role}
        organizationId={organizationId}
        organizationName={organization.name}
        actorRole={organization.role === "owner" ? "owner" : "admin"}
        onCreated={() => {
          setInvitationCreations((count) => count + 1);
        }}
      />
      <PendingInvitationsSection
        organizationId={organizationId}
        organizationName={organization.name}
        refreshMembershipContext={refreshAfterAuthorizationDenied}
        createdSignal={invitationCreations}
      />
      {revoke.scopeCurrent && revoke.confirmation !== null ? (
        <ConfirmDialog
          title="ยืนยันการถอนสมาชิก"
          description={
            <>
              <p>
                ถอน {revoke.confirmation.member.name} (
                {revoke.confirmation.member.email}) ออกจากองค์กร{" "}
                {organization.name} ({organization.slug})
              </p>
              <p className="mt-2">
                สมาชิกจะเข้าถึงองค์กรนี้ไม่ได้ทันที
                แต่บัญชีและสมาชิกภาพในองค์กรอื่นยังอยู่
              </p>
            </>
          }
          confirmLabel="ยืนยันการถอนสมาชิก"
          confirmVariant="destructive"
          pendingLabel="กำลังถอนสมาชิก…"
          pending={revoke.pending}
          opener={revoke.confirmation.opener}
          fallbackFocus={memberPageHeadingRef}
          onCancel={revoke.cancel}
          onConfirm={revoke.confirm}
        />
      ) : null}
      {roleChange.scopeCurrent &&
      actorRole === "owner" &&
      roleChange.confirmation !== null ? (
        <ConfirmDialog
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
      <section
        aria-labelledby="members-directory-title"
        className="flex flex-col gap-4"
      >
        <SectionHeader
          id="members-directory-title"
          code="02"
          title="รายชื่อสมาชิก"
          meta={
            !list.isFetching && !list.isError && !invalidPage && list.data ? (
              <span>
                <span className="font-mono">{list.data.page.total}</span> คน
              </span>
            ) : undefined
          }
        />
        {roleChange.pendingText !== null ? (
          <Notice tone="pending">{roleChange.pendingText}</Notice>
        ) : null}
        {roleChange.scopeCurrent && roleChange.notice !== null ? (
          roleChange.notice.tone === "success" ? (
            <Notice tone="success">{roleChange.notice.text}</Notice>
          ) : (
            <Alert tone="error">{roleChange.notice.text}</Alert>
          )
        ) : null}
        {revoke.pendingText !== null ? (
          <Notice tone="pending">{revoke.pendingText}</Notice>
        ) : null}
        {revoke.scopeCurrent && revoke.notice !== null ? (
          revoke.notice.tone === "success" ? (
            <Notice tone="success">{revoke.notice.text}</Notice>
          ) : (
            <Alert tone="error">{revoke.notice.text}</Alert>
          )
        ) : null}
        {directory}
      </section>
    </Page>
  );
}
