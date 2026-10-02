import type { PendingInvitation } from "@nightwatch/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { DataTable, DataTablePagination } from "../../components/ui/data-table";
import { SectionHeader } from "../../components/ui/section-header";
import { StatusPill } from "../../components/ui/status-pill";
import { Skeleton } from "../../components/shell/Skeleton";
import {
  fetchPendingInvitations,
  pendingInvitationListQueryKey,
} from "../../lib/api/invitations";
import { formatDateTime, usePreferences } from "../../lib/preferences";
import { ROLE_LABELS } from "../../lib/roles";
import {
  InvitationCancelButton,
  useInvitationCancel,
} from "./InvitationCancelAction";
import {
  InvitationResendButton,
  useInvitationResend,
} from "./InvitationResendAction";
import { useOrganizationScope } from "./useOrganizationScope";

const LIMIT = 50;

type ControlKind = "cancel" | "resend";
// A row's `publicId` or "heading", and which of the row's buttons takes focus.
type FocusRequest = { kind: ControlKind; target: string };

// Browser clock that ticks again when the next cooldown on the page ends.
function useNow(deadlines: readonly string[]) {
  const [now, setNow] = useState(() => Date.now());
  // Bumped by each timer so the effect re-arms for the next deadline.
  const [tick, setTick] = useState(0);
  const key = deadlines.join(",");
  useEffect(() => {
    const current = Date.now();
    setNow(current);
    const upcoming = key
      .split(",")
      .map((deadline) => Date.parse(deadline))
      .filter((deadline) => deadline > current);
    if (upcoming.length === 0) return;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
        setTick((value) => value + 1);
      },
      Math.min(...upcoming) - current,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [key, tick]);
  return now;
}

/**
 * Pending invitations of one Organization, rendered only for owner/admin by
 * the page. The "การทำงาน" column holds resend and cancel, each with its own
 * confirmation. `invitation.publicId` is the row key and the action target only; the invitation id and link never reach this
 * component. One status region carries the loading text, the pending text of
 * an action and its notice.
 */
export function PendingInvitationsSection({
  organizationId,
  organizationName,
  refreshMembershipContext,
  createdSignal,
}: {
  organizationId: string;
  organizationName: string;
  refreshMembershipContext: () => Promise<unknown>;
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
  // Keyed by publicId so the DOM never carries an identifier.
  const controls = useRef({
    cancel: new Map<string, HTMLElement>(),
    resend: new Map<string, HTMLElement>(),
  });
  const pendingFocus = useRef<FocusRequest | null>(null);
  const queryClient = useQueryClient();
  const [lastAction, setLastAction] = useState<ControlKind>("cancel");
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
  const cancel = useInvitationCancel({
    organizationId,
    rows: data?.invitations ?? [],
    refetchList: list.refetch,
    refreshMembershipContext,
    requestFocus: (target) => {
      pendingFocus.current = { kind: "cancel", target };
    },
  });
  const resend = useInvitationResend({
    organizationId,
    refetchList: list.refetch,
    // The resent row now leads page 1; the observer joins this fetch once the
    // offset changes, so the page never shows data of the old offset.
    loadFirstPage: async () => {
      setOffset(0);
      try {
        const first = await queryClient.query({
          queryKey: pendingInvitationListQueryKey(organizationId, LIMIT, 0),
          queryFn: () => fetchPendingInvitations(organizationId, LIMIT, 0),
          staleTime: 0,
        });
        return { data: first, isError: false };
      } catch {
        return { isError: true };
      }
    },
    refreshMembershipContext,
    requestFocus: (target) => {
      pendingFocus.current = { kind: "resend", target };
    },
  });
  const busy = cancel.pending || resend.pending;
  const now = useNow(
    data?.invitations.map((row) => row.resendAvailableAt) ?? [],
  );
  // Rows unmount while the list refetches, so focus is placed once it settles.
  useEffect(() => {
    const request = pendingFocus.current;
    if (request === null || busy || !((settled && !pastEnd) || failed)) return;
    pendingFocus.current = null;
    const control =
      request.target === "heading"
        ? undefined
        : controls.current[request.kind].get(request.target);
    (control ?? headingRef.current)?.focus();
  }, [settled, pastEnd, failed, busy, offset]);

  if (!scopeCurrent) return null;

  function changePage(next: number) {
    if (busy) return;
    pendingFocus.current = { kind: "cancel", target: "heading" };
    setOffset(next);
  }

  function register(
    kind: ControlKind,
    publicId: string,
    control: HTMLElement | null,
  ) {
    if (control === null) controls.current[kind].delete(publicId);
    else controls.current[kind].set(publicId, control);
  }

  const showData = settled && !pastEnd;
  const pendingText = resend.pendingText ?? cancel.pendingText;
  const dialogOpen =
    cancel.confirmation !== null || resend.confirmation !== null;
  const notice = lastAction === "resend" ? resend.notice : cancel.notice;
  let body;
  if (!showData && failed) {
    body = (
      <>
        <Alert tone="error">โหลดคำเชิญไม่สำเร็จ</Alert>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              pendingFocus.current = { kind: "cancel", target: "heading" };
              void list.refetch();
            }}
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
      <div aria-busy="true" className="flex flex-col gap-px">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (data.page.total === 0) {
    body = (
      <div className="flex flex-col items-center gap-1 rounded-md border border-foreground/10 bg-surface px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">
          ไม่มีคำเชิญที่รอตอบรับ
        </p>
        <p className="text-[13px] text-foreground-secondary">
          คำเชิญที่ส่งจากการ์ดด้านบนจะแสดงที่นี่จนกว่าผู้รับจะตอบรับ
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <DataTable<PendingInvitation>
          ariaLabel="ตารางคำเชิญที่รอตอบรับ"
          columns={[
            {
              key: "email",
              header: "อีเมล",
              mono: true,
              cell: (item) =>
                item.expired ? (
                  <span className="text-foreground-secondary">
                    {item.email}
                  </span>
                ) : (
                  item.email
                ),
            },
            {
              key: "role",
              header: "บทบาท",
              width: "160px",
              cell: (item) => (
                <StatusPill tone="neutral">{ROLE_LABELS[item.role]}</StatusPill>
              ),
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
            {
              key: "actions",
              header: "การทำงาน",
              align: "end",
              cell: (item) => (
                <div className="flex flex-wrap items-start justify-end gap-2">
                  <InvitationResendButton
                    invitation={item}
                    now={now}
                    pending={busy}
                    register={(publicId, control) => {
                      register("resend", publicId, control);
                    }}
                    onResend={(invitation, opener) => {
                      resend.request(invitation, opener);
                    }}
                  />
                  <InvitationCancelButton
                    invitation={item}
                    pending={busy}
                    register={(publicId, control) => {
                      register("cancel", publicId, control);
                    }}
                    onCancel={(invitation, opener) => {
                      cancel.request(invitation, opener);
                    }}
                  />
                </div>
              ),
            },
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

  const quotaPercent = showData
    ? Math.min(100, (data.activeCount / data.activeLimit) * 100)
    : 0;
  return (
    <section
      aria-labelledby="pending-invitations-title"
      className="flex flex-col gap-4"
    >
      <SectionHeader
        id="pending-invitations-title"
        code="01"
        headingRef={headingRef}
        headingTabIndex={-1}
        headingClassName="outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        title={
          <>
            คำเชิญที่รอตอบรับ
            {showData ? (
              <>
                {" ("}
                <span className="font-mono">{String(data.activeCount)}</span>
                {" จาก "}
                <span className="font-mono">{String(data.activeLimit)}</span>
                {")"}
              </>
            ) : null}
          </>
        }
        note="คำเชิญที่หมดอายุไม่นับในโควตา"
        meta={
          showData ? (
            <div
              aria-hidden="true"
              className="flex items-center gap-2 text-xs text-foreground-secondary"
            >
              <span>โควตา</span>
              <span className="block h-1 w-[120px] surface-active">
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${String(quotaPercent)}%` }}
                />
              </span>
            </div>
          ) : undefined
        }
      />
      <div role="status" className="flex flex-col gap-1 text-sm empty:sr-only">
        {showData || failed ? null : (
          <p className="text-foreground-secondary">กำลังโหลดคำเชิญ</p>
        )}
        {pendingText === null || dialogOpen ? null : (
          <p className="text-foreground-secondary">{pendingText}</p>
        )}
        {notice === null ? null : (
          <p
            className={
              "rounded-md border border-foreground/10 bg-surface px-3.5 py-2.5 " +
              (notice.tone === "success"
                ? "text-primary"
                : notice.tone === "warning"
                  ? "text-caution"
                  : "text-danger")
            }
          >
            {notice.text}
          </p>
        )}
      </div>
      {body}
      {cancel.confirmation === null ? null : (
        <ConfirmDialog
          title="ยืนยันการยกเลิกคำเชิญ"
          description={
            <>
              <p>
                ยกเลิกคำเชิญถึง {cancel.confirmation.invitation.email} (
                {ROLE_LABELS[cancel.confirmation.invitation.role]}) ขององค์กร{" "}
                {organizationName}
              </p>
              <p className="mt-2">
                ลิงก์เชิญเดิมจะใช้ไม่ได้
                ผู้รับต้องได้รับคำเชิญใหม่จึงจะเข้าร่วมได้
              </p>
            </>
          }
          confirmLabel="ยืนยันการยกเลิกคำเชิญ"
          cancelLabel="กลับ"
          confirmVariant="destructive"
          pendingLabel="กำลังยกเลิกคำเชิญ…"
          pending={cancel.pending}
          opener={cancel.confirmation.opener}
          fallbackFocus={headingRef}
          onCancel={cancel.cancel}
          onConfirm={() => {
            setLastAction("cancel");
            cancel.confirm();
          }}
        />
      )}
      {resend.confirmation === null ? null : (
        <ConfirmDialog
          title="ยืนยันการส่งคำเชิญซ้ำ"
          description={
            <>
              <p>
                ส่งซ้ำคำเชิญถึง {resend.confirmation.invitation.email} (
                {ROLE_LABELS[resend.confirmation.invitation.role]}) ขององค์กร{" "}
                {organizationName}
              </p>
              <p className="mt-2">
                ลิงก์เชิญเดิมจะใช้ไม่ได้ ระบบส่งลิงก์ใหม่ที่มีอายุ 48 ชั่วโมง
              </p>
            </>
          }
          confirmLabel="ยืนยันการส่งคำเชิญซ้ำ"
          cancelLabel="กลับ"
          pendingLabel="กำลังส่ง…"
          pending={resend.pending}
          opener={resend.confirmation.opener}
          fallbackFocus={headingRef}
          onCancel={resend.cancel}
          onConfirm={() => {
            setLastAction("resend");
            resend.confirm();
          }}
        />
      )}
    </section>
  );
}
