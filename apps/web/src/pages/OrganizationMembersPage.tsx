import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
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
  const { me, mePending, refreshMembershipContext } = useTenant();
  const navigate = useNavigate();
  const [membershipRefreshState, setMembershipRefreshState] = useState<
    "idle" | "refreshing" | "failed" | "list-failed"
  >("idle");
  const [offset, setOffset] = useState(0);
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

  const refreshAfterAuthorizationDenied = useCallback(async () => {
    setMembershipRefreshState("refreshing");
    const context = await refreshMembershipContext();
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
      setMembershipRefreshState(result.isError ? "list-failed" : "idle");
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
  }, [navigate, organizationId, refetchList, refreshMembershipContext]);

  useEffect(() => {
    if (
      !isAuthorizationDenied(list.error) ||
      membershipRefreshState !== "idle"
    ) {
      return;
    }
    void refreshAfterAuthorizationDenied();
  }, [list.error, membershipRefreshState, refreshAfterAuthorizationDenied]);
  if (
    membershipRefreshState === "refreshing" ||
    membershipRefreshState === "failed"
  ) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <Alert tone="error">ไม่สามารถยืนยันสิทธิ์ดูรายชื่อสมาชิกได้</Alert>
        {membershipRefreshState === "failed" ? (
          <Button onClick={() => void refreshAfterAuthorizationDenied()}>
            ลองอีกครั้ง
          </Button>
        ) : null}
      </Page>
    );
  }
  if (membershipRefreshState === "list-failed") {
    return (
      <Page>
        <PageHeader title="สมาชิก" />
        <Alert tone="error">โหลดสมาชิกไม่สำเร็จ</Alert>
        <Button
          onClick={() =>
            void refetchList().then((result) => {
              if (!result.isError) setMembershipRefreshState("idle");
            })
          }
        >
          ลองอีกครั้ง
        </Button>
      </Page>
    );
  }
  if (mePending) {
    return <p role="status">กำลังโหลดสมาชิก</p>;
  }
  if (organization === undefined || !canRead) {
    return (
      <Page>
        <PageHeader title="สมาชิกองค์กร" />
        <Alert tone="error">คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้</Alert>
      </Page>
    );
  }
  if (list.isPending) {
    return (
      <Page>
        <PageHeader
          eyebrow={`${organization.name} · ${organization.slug}`}
          title="สมาชิก"
        />
        <p role="status">กำลังโหลดสมาชิก</p>
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }
  if (list.isError) {
    return (
      <Page>
        <PageHeader
          eyebrow={`${organization.name} · ${organization.slug}`}
          title="สมาชิก"
        />
        <Alert tone="error">โหลดสมาชิกไม่สำเร็จ</Alert>
        <Button onClick={() => void list.refetch()}>ลองอีกครั้ง</Button>
      </Page>
    );
  }
  const data = list.data;
  if (data.organizationId !== organizationId) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + data.members.length < data.page.total;
  return (
    <Page>
      <PageHeader
        eyebrow={`${organization.name} · ${organization.slug}`}
        title="สมาชิก"
        description={`สมาชิกทั้งหมด ${String(data.page.total)} คน`}
      />
      <div className="overflow-x-auto rounded-md border border-foreground/10 bg-surface">
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
    </Page>
  );
}
