import type { PendingInvitation } from "@nightwatch/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { DataTable, DataTablePagination } from "../../components/ui/data-table";
import { StatusPill } from "../../components/ui/status-pill";
import { Skeleton } from "../../components/shell/Skeleton";
import {
  fetchPendingInvitations,
  pendingInvitationListQueryKey,
} from "../../lib/api/invitations";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import { ROLE_LABELS } from "../../lib/roles";
import { useOrganizationScope } from "./useOrganizationScope";

const LIMIT = 50;

/**
 * Pending invitations of one Organization, rendered only for owner/admin by
 * the page. The row cells and the "การทำงาน" column are the slot NODE-F006-02
 * and NODE-F006-03 fill with cancel and resend. `invitation.publicId` is the
 * row key only; the invitation id and link never reach this component.
 */
export function PendingInvitationsSection({
  organizationId,
  createdSignal,
}: {
  organizationId: string;
  // Bumped by the page after an invitation is created; the new row leads page 1.
  createdSignal: number;
}) {
  const { scopeCurrent } = useOrganizationScope(organizationId);
  const { preferences } = usePreferences();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (createdSignal > 0) setOffset(0);
  }, [createdSignal]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingWhenSettled = useRef(false);
  const list = useQuery({
    queryKey: pendingInvitationListQueryKey(organizationId, LIMIT, offset),
    queryFn: () => fetchPendingInvitations(organizationId, LIMIT, offset),
  });
  const data =
    list.data?.organizationId === organizationId ? list.data : undefined;
  const settled = !list.isFetching && !list.isError && data !== undefined;
  const failed = !list.isFetching && list.isError;
  const lastPageOffset =
    data === undefined
      ? 0
      : Math.floor((Math.max(data.page.total, 1) - 1) / LIMIT) * LIMIT;
  // A refresh can leave the open page past the end; load the last page that has rows.
  const pastEnd =
    settled &&
    data.invitations.length === 0 &&
    data.page.total > 0 &&
    offset > 0;
  useEffect(() => {
    if (pastEnd) setOffset(lastPageOffset);
  }, [pastEnd, lastPageOffset]);
  useEffect(() => {
    if (((settled && !pastEnd) || failed) && focusHeadingWhenSettled.current) {
      focusHeadingWhenSettled.current = false;
      headingRef.current?.focus();
    }
  }, [settled, pastEnd, failed]);

  if (!scopeCurrent) return null;

  function changePage(next: number) {
    focusHeadingWhenSettled.current = true;
    setOffset(next);
  }

  const showData = settled && !pastEnd;
  let body;
  if (!showData && failed) {
    body = (
      <>
        <Alert tone="error">โหลดคำเชิญไม่สำเร็จ</Alert>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void list.refetch()}
          >
            ลองอีกครั้ง
          </Button>
          {offset > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                changePage(Math.max(0, offset - LIMIT));
              }}
            >
              หน้าก่อนหน้า
            </Button>
          ) : null}
        </div>
      </>
    );
  } else if (!showData) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  } else if (data.page.total === 0) {
    body = (
      <p className="text-sm text-foreground-secondary">
        ไม่มีคำเชิญที่รอตอบรับ
      </p>
    );
  } else {
    body = (
      <>
        <DataTable<PendingInvitation>
          ariaLabel="ตารางคำเชิญที่รอตอบรับ"
          columns={[
            { key: "email", header: "อีเมล", cell: (item) => item.email },
            {
              key: "role",
              header: "บทบาท",
              width: "160px",
              cell: (item) => <StatusPill>{ROLE_LABELS[item.role]}</StatusPill>,
            },
            {
              key: "sentAt",
              header: "ส่งเมื่อ",
              cell: (item) => (
                <time dateTime={item.sentAt}>
                  {formatDateTime(new Date(item.sentAt), preferences)}
                </time>
              ),
            },
            {
              key: "expiresAt",
              header: "หมดอายุ",
              cell: (item) =>
                item.expired || item.expiresAt === null ? (
                  <StatusPill tone="caution">หมดอายุ</StatusPill>
                ) : (
                  <time dateTime={item.expiresAt}>
                    {formatDateTime(new Date(item.expiresAt), preferences)}
                  </time>
                ),
            },
            { key: "actions", header: "การทำงาน", cell: () => null },
          ]}
          rows={data.invitations}
          rowKey={(item) => item.publicId}
        />
        <DataTablePagination
          ariaLabel="หน้าคำเชิญ"
          summary={`คำเชิญทั้งหมด ${String(data.page.total)} รายการ`}
          previousLabel="หน้าก่อนหน้า"
          nextLabel="หน้าถัดไป"
          hasPrevious={offset > 0}
          hasNext={offset + data.invitations.length < data.page.total}
          onPrevious={() => {
            changePage(Math.max(0, offset - LIMIT));
          }}
          onNext={() => {
            changePage(offset + LIMIT);
          }}
        />
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby="pending-invitations-title" padding="md">
      <div className="flex flex-col gap-1">
        <h2
          id="pending-invitations-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold text-heading focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          คำเชิญที่รอตอบรับ
          {showData
            ? ` (${String(data.activeCount)} จาก ${String(data.activeLimit)})`
            : null}
        </h2>
        <p className="text-sm text-foreground-secondary">
          คำเชิญที่หมดอายุไม่นับในโควตา
        </p>
      </div>
      {showData || failed ? null : (
        <p role="status" className="text-sm text-foreground-secondary">
          กำลังโหลดคำเชิญ
        </p>
      )}
      {body}
    </Card>
  );
}
