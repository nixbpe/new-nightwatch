import type {
  OrganizationMember,
  OrganizationRole,
} from "@nightwatch/api-contract";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { textInputClass } from "../../components/ui";
import {
  INVITABLE_ROLES,
  ADMIN_INVITABLE_ROLES,
  ROLE_LABELS,
} from "../../lib/roles";

export function MemberRoleActions({
  member,
  actorRole,
  pending,
  onSave,
}: {
  member: OrganizationMember;
  actorRole: "owner" | "admin";
  pending: boolean;
  onSave: (
    member: OrganizationMember,
    role: OrganizationRole,
    opener: HTMLElement,
  ) => void;
}) {
  const [role, setRole] = useState<OrganizationRole>(member.role);
  if (actorRole === "admin" && member.role === "owner")
    return <span>{ROLE_LABELS[member.role]}</span>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-foreground-secondary">
        <span>บทบาทของ {member.name}</span>
        <select
          className={`${textInputClass} min-w-32`}
          value={role}
          disabled={pending}
          onChange={(event) => {
            setRole(event.target.value as OrganizationRole);
          }}
        >
          {(actorRole === "owner"
            ? INVITABLE_ROLES
            : ADMIN_INVITABLE_ROLES
          ).map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={pending || role === member.role}
        onClick={(event) => {
          onSave(member, role, event.currentTarget);
        }}
        aria-label={`บันทึกบทบาทของ ${member.name}`}
      >
        บันทึก
      </Button>
    </div>
  );
}
