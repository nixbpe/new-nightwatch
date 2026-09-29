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
import { Page, PageHeader } from "../components/shell/Page";
import { Skeleton } from "../components/shell/Skeleton";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../lib/api/members";
import { useTenant } from "../lib/tenant/TenantProvider";
import { InvitationPanel } from "./organization-members/InvitationPanel";
import { Card } from "../components/ui/card";

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
        <Card
          role="status"
          aria-label="กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก"
          padding="md"
        >
          <p className="text-sm text-foreground-secondary">
            กำลังตรวจสอบสิทธิ์ดูรายชื่อสมาชิก
          </p>
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-64 w-full" />
        </Card>
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
                  <td className="p-4">{member.role}</td>
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
      {directory}
    </Page>
  );
}
