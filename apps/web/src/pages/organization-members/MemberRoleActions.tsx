import type {
  OrganizationMember,
  OrganizationMemberListResponse,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";

import { textInputClass } from "../../components/ui";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import {
  MEMBER_LIST_QUERY_PREFIX,
  updateOrganizationMemberRole,
} from "../../lib/api/members";
import {
  ADMIN_INVITABLE_ROLES,
  INVITABLE_ROLES,
  ROLE_LABELS,
} from "../../lib/roles";
import { useOrganizationScope } from "./useOrganizationScope";

export type ActorRole = "owner" | "admin";
export type RoleNotice = { tone: "success" | "error"; text: string };
export type RoleConfirmation = {
  member: OrganizationMember;
  role: OrganizationRole;
  opener: HTMLElement;
};

const MEMBER_SELECT_ATTRIBUTE = "data-member-role-select";

/**
 * Role change flow for one Organization's member page: owner confirmation,
 * pending guard, the persisted-role check after the PATCH and the stale-scope
 * guard (`useOrganizationScope`). Reads the PATCH result only through a
 * refetch of the list, so success is never shown for an unpersisted role.
 */
export function useMemberRoleChange({
  organizationId,
  actorRole,
  actorUserId,
  listSettled,
  headingRef,
  refetchList,
  refreshMembershipContext,
}: {
  organizationId: string;
  actorRole: ActorRole;
  actorUserId: string | undefined;
  listSettled: boolean;
  /** The dialog parks focus here when its opener unmounts with the table. */
  headingRef: RefObject<HTMLElement | null>;
  refetchList: () => Promise<{
    data?: OrganizationMemberListResponse;
    isError: boolean;
  }>;
  refreshMembershipContext: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);

  const [pending, setPending] = useState(false);
  const [pendingChange, setPendingChange] = useState<{
    name: string;
    role: OrganizationRole;
  } | null>(null);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<RoleNotice | null>(null);
  const [confirmation, setConfirmation] = useState<RoleConfirmation | null>(
    null,
  );
  // Member whose control had focus; the list skeleton unmounts it on refetch.
  const focusMemberId = useRef<string | null>(null);

  useEffect(() => {
    if (actorRole !== "owner") setConfirmation(null);
  }, [actorRole]);

  useEffect(() => {
    const memberId = focusMemberId.current;
    if (memberId === null || pending || !listSettled || !isCurrentScope()) {
      return;
    }
    focusMemberId.current = null;
    const active = document.activeElement;
    if (active !== document.body && active !== headingRef.current) return;
    const control = Array.from(
      document.querySelectorAll<HTMLElement>(`[${MEMBER_SELECT_ATTRIBUTE}]`),
    ).find((element) => element.dataset.memberRoleSelect === memberId);
    control?.focus();
  }, [headingRef, isCurrentScope, listSettled, pending]);

  async function submit(member: OrganizationMember, role: OrganizationRole) {
    if (inFlight.current || !isCurrentScope()) return;
    inFlight.current = true;
    setPending(true);
    setPendingChange({ name: member.name, role });
    setNotice(null);
    let failure: unknown = null;
    try {
      const response = await updateOrganizationMemberRole(
        organizationId,
        member.id,
        role,
      );
      if (
        response.member.organizationId !== organizationId ||
        response.member.id !== member.id
      ) {
        throw new Error("Role response does not match the requested member");
      }
    } catch (error) {
      failure = error;
    }
    if (!isCurrentScope()) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [...MEMBER_LIST_QUERY_PREFIX, organizationId],
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: ME_CONTEXT_QUERY_KEY,
        refetchType: "none",
      }),
    ]);
    if (!isCurrentScope()) return;
    setConfirmation(null);
    // A refetch, not the PATCH response, decides what the notice says.
    const refreshed = await refetchList();
    if (!isCurrentScope()) return;
    const persisted = refreshed.isError
      ? undefined
      : refreshed.data?.members.find((item) => item.id === member.id);
    if (refreshed.isError) {
      // A denied list recovers through the page's membership refresh.
      setNotice(null);
    } else if (failure !== null) {
      setNotice({
        tone: "error",
        text:
          failure instanceof ApiError && failure.code === "LAST_OWNER"
            ? "องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน ไม่ได้เปลี่ยนบทบาท และโหลดบทบาทล่าสุดแล้ว"
            : "บันทึกบทบาทไม่สำเร็จ โหลดบทบาทล่าสุดแล้ว",
      });
    } else if (persisted === undefined) {
      setNotice({
        tone: "error",
        text: "ไม่พบสมาชิกในรายการล่าสุด ไม่สามารถยืนยันบทบาทได้",
      });
    } else if (persisted.role !== role) {
      setNotice({
        tone: "error",
        text: "บทบาทของสมาชิกถูกเปลี่ยนโดยผู้อื่น โหลดบทบาทล่าสุดแล้ว",
      });
    } else {
      setNotice({ tone: "success", text: "บันทึกบทบาทแล้ว" });
    }
    const currentActor = refreshed.data?.members.find(
      (item) => item.userId === actorUserId,
    );
    // Absence from this page (normal on page 2+) says nothing about the actor's
    // role. Refresh when the actor successfully changed their own role, their
    // listed role differs from before, or the PATCH was PERMISSION_DENIED (the
    // actor's role changed elsewhere, even if their row is not on this page).
    const permissionDenied =
      failure instanceof ApiError && failure.code === "PERMISSION_DENIED";
    if (
      !refreshed.isError &&
      (permissionDenied ||
        (member.userId === actorUserId && failure === null) ||
        (currentActor !== undefined && currentActor.role !== actorRole))
    ) {
      await refreshMembershipContext();
      if (!isCurrentScope()) return;
    }
    inFlight.current = false;
    setPending(false);
  }

  function request(
    member: OrganizationMember,
    role: OrganizationRole,
    opener: HTMLElement,
  ) {
    if (inFlight.current || !isCurrentScope()) return;
    if (
      actorRole !== "owner" &&
      (member.role === "owner" || role === "owner")
    ) {
      return;
    }
    if (member.role === "owner" || role === "owner") {
      setConfirmation({ member, role, opener });
      return;
    }
    focusMemberId.current =
      document.activeElement === opener ? member.id : null;
    void submit(member, role);
  }

  // A retired scope never finishes its submit, so it must not stay pending.
  const livePending = scopeCurrent && pending;
  return {
    scopeCurrent,
    pending: livePending,
    pendingText:
      livePending && pendingChange !== null
        ? `กำลังบันทึกบทบาทของ ${pendingChange.name} เป็น ${ROLE_LABELS[pendingChange.role] ?? pendingChange.role}…`
        : null,
    notice,
    confirmation,
    request,
    confirm: () => {
      if (confirmation === null) return;
      focusMemberId.current = confirmation.member.id;
      void submit(confirmation.member, confirmation.role);
    },
    cancel: () => {
      if (!inFlight.current) setConfirmation(null);
    },
  };
}

export function MemberRoleActions({
  member,
  actorRole,
  pending,
  onSave,
}: {
  member: OrganizationMember;
  actorRole: ActorRole;
  pending: boolean;
  onSave: (
    member: OrganizationMember,
    role: OrganizationRole,
    opener: HTMLElement,
  ) => void;
}) {
  const [role, setRole] = useState<OrganizationRole>(member.role);
  if (actorRole === "admin" && member.role === "owner") return null;
  const roles = actorRole === "owner" ? INVITABLE_ROLES : ADMIN_INVITABLE_ROLES;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 py-1 sm:flex-nowrap">
      <select
        {...{ [MEMBER_SELECT_ATTRIBUTE]: member.id }}
        aria-label={`บทบาทใหม่ของ ${member.name}`}
        className={cn(textInputClass, "h-8 w-32 shrink-0 py-0 text-xs")}
        value={role}
        disabled={pending}
        onChange={(event) => {
          setRole(event.target.value as OrganizationRole);
        }}
      >
        {roles.map((value) => (
          <option key={value} value={value}>
            {ROLE_LABELS[value]}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || role === member.role}
        aria-label={`บันทึกบทบาทของ ${member.name}`}
        onClick={(event) => {
          onSave(member, role, event.currentTarget);
        }}
      >
        บันทึก
      </Button>
    </div>
  );
}
