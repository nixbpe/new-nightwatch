import {
  ORGANIZATION_MEMBER_SEARCH_MAX_LENGTH,
  organizationRoleSchema,
} from "@nightwatch/api-contract";
import { useState, type RefObject, type SyntheticEvent } from "react";

import { Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import type { MemberListFilter } from "../../lib/api/members";
import { ROLE_LABELS } from "../../lib/roles";

// While a change is saving the controls are `aria-disabled`, not `disabled`, so the
// field that was just used keeps focus.
export function MemberFilterBar({
  filter,
  busy,
  searchRef,
  onChange,
  onClear,
}: {
  filter: MemberListFilter;
  busy: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onChange: (next: MemberListFilter) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(filter.q ?? "");
  const [seenQuery, setSeenQuery] = useState(filter.q);
  if (seenQuery !== filter.q) {
    setSeenQuery(filter.q);
    setDraft(filter.q ?? "");
  }
  const active = filter.q !== undefined || filter.role !== undefined;

  const submitSearch = (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy) return;
    // The API rejects control characters (a pasted tab, say): drop them before the request.
    // eslint-disable-next-line no-control-regex -- the point is to remove them
    const q = draft.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    onChange({ ...filter, q: q === "" ? undefined : q });
  };

  return (
    <form
      data-testid="members-filter-form"
      role="search"
      aria-label="กรองสมาชิก"
      onSubmit={submitSearch}
      className="flex flex-wrap items-end gap-x-3 gap-y-3"
    >
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        ค้นหา
        <Input
          ref={searchRef}
          data-testid="members-filter-search"
          type="search"
          value={draft}
          placeholder="ชื่อหรืออีเมล"
          maxLength={ORGANIZATION_MEMBER_SEARCH_MAX_LENGTH}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          className="w-80 max-w-full text-sm"
        />
      </label>
      <Button
        data-testid="members-filter-submit"
        type="submit"
        variant="secondary"
        aria-disabled={busy ? true : undefined}
      >
        ค้นหา
      </Button>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        บทบาท
        <Select
          data-testid="members-filter-role"
          value={filter.role ?? ""}
          aria-disabled={busy ? true : undefined}
          onChange={(event) => {
            if (busy) return;
            const role = organizationRoleSchema.safeParse(event.target.value);
            onChange({ ...filter, role: role.success ? role.data : undefined });
          }}
          className="w-auto min-w-40"
        >
          <option value="">ทุกบทบาท</option>
          {organizationRoleSchema.options.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </label>
      {active ? (
        <Button
          data-testid="members-filter-clear"
          type="button"
          variant="secondary"
          aria-disabled={busy ? true : undefined}
          onClick={() => {
            if (!busy) onClear();
          }}
        >
          ล้างตัวกรอง
        </Button>
      ) : null}
    </form>
  );
}
