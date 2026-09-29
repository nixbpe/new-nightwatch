import type {
  OrganizationMember,
  OrganizationRole,
  MeContextResponse,
} from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Alert } from "../components/ui";
import { Button } from "../components/ui/button";
import { Page, PageHeader } from "../components/shell/Page";
import { Skeleton } from "../components/shell/Skeleton";
import { ApiError } from "../lib/api/client";
import {
  MEMBER_LIST_QUERY_PREFIX,
  fetchOrganizationMembers,
  memberListQueryKey,
  updateOrganizationMemberRole,
} from "../lib/api/members";
import { ME_CONTEXT_QUERY_KEY } from "../lib/api/me";
import {
  getContextPublicationSnapshot,
  subscribeToContextPublication,
} from "../lib/queryClient";
import { ROLE_LABELS } from "../lib/roles";
import { useTenant } from "../lib/tenant/TenantProvider";
import { InvitationPanel } from "./organization-members/InvitationPanel";
import { MemberActionDialog } from "./organization-members/MemberActionDialog";
import { MemberRoleActions } from "./organization-members/MemberRoleActions";

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
  const directRoleFocusMemberId = useRef<string | null>(null);
  const directRoleActionCellRef = useRef<HTMLTableCellElement>(null);
  const location = useLocation();
  useEffect(() => {
    const navigationState: unknown = location.state;
    if (
      navigationState !== null &&
      typeof navigationState === "object" &&
      "focusMemberHeadingFor" in navigationState &&
      navigationState.focusMemberHeadingFor === organizationId
    ) {
      memberPageHeadingRef.current?.focus();
    }
  }, [location.key, location.state, organizationId]);
  const [confirmation, setConfirmation] = useState<{
    member: OrganizationMember;
    role: OrganizationRole;
    opener: HTMLElement;
  } | null>(null);
  const [roleNotice, setRoleNotice] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [rolePending, setRolePending] = useState(false);
  const roleInFlight = useRef(false);
  const publicationVersion = useRef(
    getContextPublicationSnapshot(queryClient).version,
  );
  const lastPublishedOrgId = useRef(
    queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
      ?.lastActiveTenantId ?? null,
  );
  const retiredRoleScope = useRef(false);
  const isCurrentRoleScope = useCallback(() => {
    const version = getContextPublicationSnapshot(queryClient).version;
    if (version !== publicationVersion.current) {
      const serverOrgId =
        queryClient.getQueryData<MeContextResponse>(ME_CONTEXT_QUERY_KEY)
          ?.lastActiveTenantId ?? null;
      if (
        serverOrgId !== lastPublishedOrgId.current &&
        serverOrgId !== organizationId
      )
        retiredRoleScope.current = true;
      publicationVersion.current = version;
      lastPublishedOrgId.current = serverOrgId;
    }
    return !retiredRoleScope.current;
  }, [organizationId, queryClient]);
  const roleScopeCurrent = useSyncExternalStore(
    useCallback(
      (listener) =>
        subscribeToContextPublication(queryClient, () => {
          isCurrentRoleScope();
          listener();
        }),
      [queryClient, isCurrentRoleScope],
    ),
    isCurrentRoleScope,
  );
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
  useEffect(() => {
    if (
      directRoleFocusMemberId.current === null ||
      rolePending ||
      list.isFetching ||
      !isCurrentRoleScope()
    )
      return;
    if (document.activeElement !== document.body) {
      directRoleFocusMemberId.current = null;
      return;
    }
    const target = directRoleActionCellRef.current?.querySelector(
      "select:not(:disabled), button:not(:disabled)",
    );
    if (
      list.data?.organizationId === organizationId &&
      !list.isError &&
      target instanceof HTMLElement &&
      target.isConnected
    ) {
      target.focus();
    } else {
      memberPageHeadingRef.current?.focus();
    }
    directRoleFocusMemberId.current = null;
  }, [
    isCurrentRoleScope,
    list.data,
    list.isError,
    list.isFetching,
    organizationId,
    rolePending,
  ]);
  async function submitRole(
    member: OrganizationMember,
    role: OrganizationRole,
  ) {
    if (roleInFlight.current || !isCurrentRoleScope()) return;
    roleInFlight.current = true;
    setRolePending(true);
    setRoleNotice(null);
    let failure: unknown = null;
    try {
      const response = await updateOrganizationMemberRole(
        organizationId,
        member.id,
        role,
      );
      if (!isCurrentRoleScope()) return;
      if (
        response.member.organizationId !== organizationId ||
        response.member.id !== member.id ||
        response.member.role !== role
      ) {
        throw new Error("Role response does not match the requested member");
      }
    } catch (error) {
      failure = error;
    }
    if (!isCurrentRoleScope()) return;
    await queryClient.invalidateQueries({
      queryKey: [...MEMBER_LIST_QUERY_PREFIX, organizationId],
      refetchType: "none",
    });
    await queryClient.invalidateQueries({
      queryKey: ME_CONTEXT_QUERY_KEY,
      refetchType: "none",
    });
    if (!isCurrentRoleScope()) return;
    setConfirmation(null);
    // A server-confirmed list is authoritative even if another actor changed
    // this member while the PATCH was pending.
    const refreshed = await refetchList();
    if (!isCurrentRoleScope()) return;
    const listAuthorizationDenied =
      refreshed.isError && isAuthorizationDenied(refreshed.error);
    if (
      refreshed.isError ||
      refreshed.data?.organizationId !== organizationId
    ) {
      setRoleNotice({
        error: true,
        text: "ไม่สามารถตรวจสอบบทบาทล่าสุดได้ กรุณาลองโหลดสมาชิกอีกครั้ง",
      });
      if (listAuthorizationDenied) void refreshAfterAuthorizationDenied();
    } else if (failure !== null) {
      setRoleNotice({
        error: true,
        text:
          failure instanceof ApiError && failure.code === "LAST_OWNER"
            ? "ต้องมีเจ้าขององค์กรอย่างน้อยหนึ่งคน บทบาทล่าสุดได้รับการโหลดแล้ว"
            : "บันทึกบทบาทไม่สำเร็จ โหลดบทบาทล่าสุดแล้ว",
      });
    } else if (
      refreshed.data.members.some(
        (current) => current.id === member.id && current.role === role,
      )
    ) {
      setRoleNotice({ error: false, text: "บันทึกบทบาทแล้ว" });
    } else {
      setRoleNotice({
        error: true,
        text: "บทบาทถูกเปลี่ยนอีกครั้ง โหลดบทบาทล่าสุดแล้ว",
      });
    }
    if (
      failure === null &&
      member.userId === me?.user.id &&
      !listAuthorizationDenied
    ) {
      const context = await refreshMembershipContext();
      if (!isCurrentRoleScope()) return;
      if (context === null) {
        setMembershipRefreshState("failed");
        setRoleNotice(null);
      }
    }
    roleInFlight.current = false;
    setRolePending(false);
  }

  function requestRoleChange(
    member: OrganizationMember,
    role: OrganizationRole,
    opener: HTMLElement,
  ) {
    if (roleInFlight.current || !isCurrentRoleScope()) return;
    if (member.role === "owner" || role === "owner") {
      setConfirmation({ member, role, opener });
    } else {
      directRoleFocusMemberId.current =
        document.activeElement === opener ? member.id : null;
      void submitRole(member, role);
    }
  }

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
        <div
          role="status"
          aria-label="กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก"
          className="flex flex-col gap-6 rounded-md border border-foreground/10 bg-surface p-6"
        >
          <p className="text-sm text-foreground-secondary">
            กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก
          </p>
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Page>
    );
  }
  if (membershipRefreshState === "failed") {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <Alert tone="error">ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้</Alert>
        <Button onClick={() => void refreshAfterAuthorizationDenied()}>
          ลองอีกครั้ง
        </Button>
      </Page>
    );
  }
  if (mePending) {
    return <p role="status">กำลังโหลดสมาชิก</p>;
  }
  if (meError !== null) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <Alert tone="error">ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้</Alert>
        <Button onClick={() => void refreshMembershipContext()}>
          ลองอีกครั้ง
        </Button>
      </Page>
    );
  }
  if (organization === undefined || !canRead) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <Alert tone="error">คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้</Alert>
      </Page>
    );
  }
  let directory: ReactNode;
  if (list.isFetching || invalidPage) {
    directory = (
      <>
        <p role="status">กำลังโหลดสมาชิก</p>
        <Skeleton className="h-64 w-full" />
      </>
    );
  } else if (list.isError || membershipRefreshState === "list-failed") {
    directory = (
      <>
        <Alert tone="error">โหลดสมาชิกไม่สำเร็จ</Alert>
        {offset > 0 ? (
          <div className="flex gap-2">
            <Button onClick={() => void retryAfterListFailure()}>
              ลองอีกครั้ง
            </Button>
            <Button
              onClick={() => {
                memberPageHeadingRef.current?.focus();
                setOffset((value) => Math.max(0, value - LIMIT));
              }}
            >
              ก่อนหน้า
            </Button>
          </div>
        ) : (
          <Button onClick={() => void retryAfterListFailure()}>
            ลองอีกครั้ง
          </Button>
        )}
      </>
    );
  } else {
    const data = list.data;
    if (data === undefined || data.organizationId !== organizationId)
      return null;
    const hasPrevious = offset > 0;
    const hasNext = offset + data.members.length < data.page.total;
    directory = (
      <>
        <div
          tabIndex={0}
          role="region"
          aria-label="ตารางสมาชิก"
          className="overflow-x-auto rounded-md border border-foreground/10 bg-surface focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-foreground/10 text-foreground-secondary">
              <tr>
                <th className="p-4">ชื่อ</th>
                <th className="p-4">อีเมล</th>
                <th className="p-4">บทบาท</th>
                <th className="p-4">เปลี่ยนบทบาท</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr
                  className="border-b border-foreground/10 last:border-0"
                  key={member.id}
                >
                  <td className="p-4">{member.name}</td>
                  <td className="p-4">{member.email}</td>
                  <td className="p-4">{ROLE_LABELS[member.role]}</td>
                  <td
                    className="p-4"
                    ref={
                      directRoleFocusMemberId.current === member.id
                        ? directRoleActionCellRef
                        : undefined
                    }
                  >
                    {roleScopeCurrent && (
                      <MemberRoleActions
                        key={`${member.id}:${member.role}`}
                        member={member}
                        actorRole={
                          organization.role === "owner" ? "owner" : "admin"
                        }
                        pending={rolePending}
                        onSave={requestRoleChange}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav
          aria-label="หน้าสมาชิก"
          className="flex flex-wrap items-center justify-between gap-4"
        >
          <p className="text-sm text-foreground-secondary">
            แสดง {data.members.length === 0 ? 0 : offset + 1}–
            {offset + data.members.length} จาก {data.page.total}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={!hasPrevious}
              onClick={() => {
                setOffset((value) => Math.max(0, value - LIMIT));
              }}
            >
              ก่อนหน้า
            </Button>
            <Button
              disabled={!hasNext}
              onClick={() => {
                setOffset((value) => value + LIMIT);
              }}
            >
              ถัดไป
            </Button>
          </div>
        </nav>
      </>
    );
  }
  return (
    <Page>
      <PageHeader
        eyebrow={`${organization.name} · ${organization.slug}`}
        title="สมาชิก"
        description={
          !list.isFetching && !list.isError && !invalidPage && list.data
            ? `สมาชิกทั้งหมด ${String(list.data.page.total)} คน`
            : undefined
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
      {roleScopeCurrent &&
        roleNotice &&
        (roleNotice.error ? (
          <Alert tone="error">{roleNotice.text}</Alert>
        ) : (
          <p role="status" className="text-sm text-primary">
            {roleNotice.text}
          </p>
        ))}
      {roleScopeCurrent && rolePending && (
        <p role="status">กำลังบันทึกบทบาท…</p>
      )}
      {roleScopeCurrent && confirmation && (
        <MemberActionDialog
          title="ยืนยันการเปลี่ยนบทบาท"
          description={`เปลี่ยนบทบาทของ ${confirmation.member.name} ในองค์กร ${organization.name} (${organization.slug}) เป็น ${String(ROLE_LABELS[confirmation.role])} การเปลี่ยนสิทธิ์เจ้าของมีผลต่อการจัดการสมาชิกและการเข้าถึงองค์กร`}
          confirmLabel="ยืนยันการเปลี่ยนบทบาท"
          pending={rolePending}
          opener={confirmation.opener}
          fallbackFocus={memberPageHeadingRef}
          onCancel={() => {
            setConfirmation(null);
          }}
          onConfirm={() =>
            void submitRole(confirmation.member, confirmation.role)
          }
        />
      )}
      {directory}
    </Page>
  );
}
