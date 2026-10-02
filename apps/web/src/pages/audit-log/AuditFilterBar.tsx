import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  AUDIT_SEARCH_MAX_LENGTH,
  type AuditActorOption,
  type AuditCategory,
} from "@nightwatch/api-contract";
import { useState, type SyntheticEvent } from "react";

import { Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import type { AuditFilters } from "../../lib/api/audit-log";
import { cn } from "../../lib/utils";
import {
  hasActiveFilters,
  RANGE_OPTIONS,
  type CustomRangeError,
} from "./filters";
import { personName } from "./labels";

const CUSTOM_ERROR_TEXT: Record<
  CustomRangeError,
  (retained?: string) => string
> = {
  "start-after-end": () => "วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด",
  "before-retention": (retained) =>
    `วันเริ่มเก่ากว่าวันที่เก็บย้อนหลังถึง (${retained ?? ""})`,
};

function Chip({
  pressed,
  busy,
  onPress,
  children,
}: {
  pressed: boolean;
  busy: boolean;
  onPress: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-pressed={pressed}
      aria-disabled={busy ? true : undefined}
      onClick={() => {
        if (!busy) onPress();
      }}
      className={cn(pressed && "border-primary bg-primary/10 text-primary")}
    >
      {children}
    </Button>
  );
}

// Step 4. While a list is loading the controls are `aria-disabled`, not `disabled`, so a
// chip that was just pressed keeps focus through the skeleton.
export function AuditFilterBar({
  filters,
  actors,
  busy,
  customError,
  retainedDay,
  onChange,
  onClear,
}: {
  filters: AuditFilters;
  actors: readonly AuditActorOption[];
  busy: boolean;
  customError: CustomRangeError | undefined;
  retainedDay: string | undefined;
  onChange: (next: Partial<AuditFilters>) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(filters.q ?? "");
  const [seenQuery, setSeenQuery] = useState(filters.q);
  if (seenQuery !== filters.q) {
    setSeenQuery(filters.q);
    setDraft(filters.q ?? "");
  }

  const toggleCategory = (category: AuditCategory) => {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((item) => item !== category)
      : [...filters.categories, category];
    onChange({ categories: next });
  };
  const submitSearch = (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy) return;
    onChange({ q: draft.trim() === "" ? undefined : draft.trim() });
  };
  const actorKnown =
    filters.actor === undefined ||
    actors.some((actor) => actor.userId === filters.actor);
  const errorId = "audit-custom-range-error";

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={submitSearch}
        role="search"
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          ค้นหา
          <Input
            type="search"
            value={draft}
            maxLength={AUDIT_SEARCH_MAX_LENGTH}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            className="w-72 max-w-full text-sm"
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          aria-disabled={busy ? true : undefined}
        >
          ค้นหา
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="ช่วงเวลา" className="flex gap-2">
          {RANGE_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              pressed={filters.range === option.value}
              busy={busy}
              onPress={() => {
                onChange({
                  range: option.value,
                  from: undefined,
                  to: undefined,
                });
              }}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label="หมวด" className="flex flex-wrap gap-2">
          {AUDIT_CATEGORIES.map((category) => (
            <Chip
              key={category}
              pressed={filters.categories.includes(category)}
              busy={busy}
              onPress={() => {
                toggleCategory(category);
              }}
            >
              {AUDIT_CATEGORY_LABELS[category]}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          ผู้ดำเนินการ
          <select
            value={filters.actor ?? ""}
            aria-disabled={busy ? true : undefined}
            onChange={(event) => {
              if (busy) return;
              onChange({ actor: event.target.value || undefined });
            }}
            className="h-10 max-w-56 rounded-md border border-control-border bg-surface px-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <option value="">ทั้งหมด</option>
            {actorKnown || filters.actor === undefined ? null : (
              <option value={filters.actor}>ผู้ดำเนินการที่เลือก</option>
            )}
            {actors.map((actor) => (
              <option key={actor.userId} value={actor.userId}>
                {personName(actor)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filters.range === "custom" ? (
        <div className="flex flex-wrap items-start gap-3">
          <label className="flex items-center gap-2 text-sm">
            วันเริ่ม
            <Input
              type="date"
              value={filters.from ?? ""}
              aria-invalid={customError === undefined ? undefined : true}
              aria-describedby={customError === undefined ? undefined : errorId}
              onChange={(event) => {
                onChange({ from: event.target.value || undefined });
              }}
              className="w-40 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            วันสิ้นสุด
            <Input
              type="date"
              value={filters.to ?? ""}
              aria-invalid={
                customError === "start-after-end" ? true : undefined
              }
              aria-describedby={
                customError === "start-after-end" ? errorId : undefined
              }
              onChange={(event) => {
                onChange({ to: event.target.value || undefined });
              }}
              className="w-40 text-sm"
            />
          </label>
          {customError === undefined ? null : (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {CUSTOM_ERROR_TEXT[customError](retainedDay)}
            </p>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-secondary">
        <p>ตัวกรองที่ใช้: {describeFilters(filters, actors)}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-disabled={busy || !hasActiveFilters(filters) ? true : undefined}
          onClick={() => {
            if (!busy && hasActiveFilters(filters)) onClear();
          }}
        >
          ล้างตัวกรอง
        </Button>
      </div>
    </div>
  );
}

export function describeFilters(
  filters: AuditFilters,
  actors: readonly AuditActorOption[],
): string {
  const range =
    filters.range === "custom"
      ? `ช่วงเวลา ${filters.from ?? "…"} ถึง ${filters.to ?? "…"}`
      : `ช่วงเวลา ${RANGE_OPTIONS.find((option) => option.value === filters.range)?.label ?? ""}`;
  const parts = [range];
  if (filters.categories.length > 0) {
    parts.push(
      `หมวด ${AUDIT_CATEGORIES.filter((category) =>
        filters.categories.includes(category),
      )
        .map((category) => AUDIT_CATEGORY_LABELS[category])
        .join(", ")}`,
    );
  }
  if (filters.actor !== undefined) {
    const actor = actors.find((item) => item.userId === filters.actor);
    parts.push(
      `ผู้ดำเนินการ ${actor === undefined ? "ที่เลือก" : personName(actor)}`,
    );
  }
  if (filters.q !== undefined) parts.push(`ค้นหา "${filters.q}"`);
  return parts.join(" · ");
}
