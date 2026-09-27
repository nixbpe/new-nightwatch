import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

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

function problem(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === "MEMBERSHIP_DENIED" ||
      error.code === "PERMISSION_DENIED"
    ) {
      return "คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกขององค์กรนี้";
    }
    return error.message;
  }
  return "ไม่สามารถโหลดรายชื่อสมาชิกได้";
}

export function OrganizationMembersPage() {
  const { organizationId } = useParams();
  if (organizationId === undefined) return null;
  return <OrganizationMembersPageForOrganization key={organizationId} organizationId={organizationId} />;
}

function OrganizationMembersPageForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const { me, mePending } = useTenant();
  const [offset, setOffset] = useState(0);
  const organization = me?.organizations.find((item) => item.id === organizationId);
  const list = useQuery({
    queryKey: memberListQueryKey(organizationId, LIMIT, offset),
    queryFn: () => fetchOrganizationMembers(organizationId, LIMIT, offset),
    enabled: organization !== undefined,
  });
  if (mePending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (organization === undefined) {
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
        <PageHeader eyebrow={`${organization.name} · ${organization.slug}`} title="สมาชิก" />
        <Skeleton className="h-64 w-full" />
      </Page>
    );
  }
  if (list.isError) {
    return (
      <Page>
        <PageHeader eyebrow={`${organization.name} · ${organization.slug}`} title="สมาชิก" />
        <Alert tone="error">{problem(list.error)}</Alert>
        <Button onClick={() => void list.refetch()}>ลองอีกครั้ง</Button>
      </Page>
    );
  }
  const data = list.data;
  if (data === undefined || data.organizationId !== organizationId) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + data.members.length < data.page.total;
  return (
    <Page>
      <PageHeader
        eyebrow={`${organization.name} · ${organization.slug}`}
        title="สมาชิก"
        description={`สมาชิกทั้งหมด ${data.page.total} คน`}
      />
      <div className="overflow-x-auto rounded-md border border-foreground/10 bg-surface">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-foreground/10 text-foreground-secondary">
            <tr><th className="p-4">ชื่อ</th><th className="p-4">อีเมล</th><th className="p-4">บทบาท</th></tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr className="border-b border-foreground/10 last:border-0" key={member.id}>
                <td className="p-4">{member.name}</td><td className="p-4">{member.email}</td><td className="p-4">{member.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="หน้าสมาชิก" className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-foreground-secondary">แสดง {data.members.length === 0 ? 0 : offset + 1}–{offset + data.members.length} จาก {data.page.total}</p>
        <div className="flex gap-2">
          <Button disabled={!hasPrevious} onClick={() => setOffset((value) => Math.max(0, value - LIMIT))}>ก่อนหน้า</Button>
          <Button disabled={!hasNext} onClick={() => setOffset((value) => value + LIMIT)}>ถัดไป</Button>
        </div>
      </nav>
    </Page>
  );
}
