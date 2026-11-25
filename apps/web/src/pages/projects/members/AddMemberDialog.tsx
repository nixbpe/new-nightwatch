import {
  PROJECT_MEMBER_ADD_MAX,
  type ProjectRole,
} from "@nightwatch/api-contract";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link } from "react-router";

import { SearchIcon } from "../../../components/shell/icons";
import { initialsOf } from "../../../components/shell/initials";
import { Alert, Field, Input } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Dialog } from "../../../components/ui/dialog";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { ApiError } from "../../../lib/api/client";
import {
  addProjectMembers,
  fetchProjectMemberCandidates,
  projectQueryKeys,
} from "../../../lib/api/projects";
import { ROLE_LABELS } from "../../../lib/roles";
import { PROJECT_ROLE_HINTS, PROJECT_ROLE_LABELS } from "./roles";

const SEARCH_DEBOUNCE_MS = 300;
// Tab order skips the roving-tabindex radios that are not selected.
const ROLE_OPTIONS = [
  { value: "member", label: PROJECT_ROLE_LABELS.member },
  { value: "admin", label: PROJECT_ROLE_LABELS.admin },
] as const;

export const NOT_IN_ORGANIZATION_MESSAGE =
  "มีผู้ใช้ที่ไม่ได้เป็นสมาชิกขององค์กรแล้ว เลือกสมาชิกใหม่อีกครั้ง";
const FAILED_MESSAGE = "เพิ่มสมาชิกไม่สำเร็จ ลองอีกครั้ง";

export type AddResult = {
  /** Newly in the Project because of this request. */
  added: number;
  /** Picked, but already in the Project: the API keeps their existing role. */
  already: number;
  role: ProjectRole;
};

export type AddStaleReason = "denied" | "not-found";

/** Picks Organization members (never outsiders) and adds them with one role. */
export function AddMemberDialog({
  organizationId,
  organizationName,
  canManageOrganization,
  projectId,
  projectName,
  opener,
  fallbackFocus,
  onAdded,
  onCancel,
  onStale,
}: {
  organizationId: string;
  organizationName: string;
  /** Owners and admins of the Organization can invite; everyone else is told whom to ask. */
  canManageOrganization: boolean;
  projectId: string;
  projectName: string;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  onAdded: (result: AddResult) => Promise<void>;
  onCancel: () => void;
  onStale: (reason: AddStaleReason) => void;
}) {
  const searchId = useId();
  const hintId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  // Selections survive a new search: they are ids, not rows of the visible list.
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<ProjectRole>("member");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const candidates = useQuery({
    queryKey: projectQueryKeys.candidates(organizationId, projectId, q),
    queryFn: () => fetchProjectMemberCandidates(organizationId, projectId, q),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (searchText.trim() === q) return;
    const timer = setTimeout(() => {
      setQ(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchText, q]);

  const staleReason = staleReasonOf(candidates.error);
  useEffect(() => {
    if (staleReason !== null) onStale(staleReason);
  }, [staleReason, onStale]);

  const cancel = () => {
    if (!inFlight.current) onCancel();
  };

  // The API takes at most PROJECT_MEMBER_ADD_MAX ids per request, and
  // selections persist across searches, so unselected rows disable at the cap.
  const full = selected.length >= PROJECT_MEMBER_ADD_MAX;

  const toggle = (userId: string) => {
    setFormError(null);
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const submit = async () => {
    if (inFlight.current || selected.length === 0) return;
    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const { addedUserIds } = await addProjectMembers(
        organizationId,
        projectId,
        { userIds: selected, role },
      );
      const inserted = new Set(addedUserIds);
      const added = selected.filter((id) => inserted.has(id)).length;
      await onAdded({ added, already: selected.length - added, role });
    } catch (error) {
      if (error instanceof ApiError) {
        const reason = staleReasonOf(error);
        if (reason !== null) {
          onStale(reason);
          return;
        }
        if (error.code === "PROJECT_MEMBER_NOT_IN_ORGANIZATION") {
          // Someone left the Organization meanwhile: the picked ids are no longer trustworthy.
          setSelected([]);
          setFormError(NOT_IN_ORGANIZATION_MESSAGE);
          void queryClient.invalidateQueries({
            queryKey: projectQueryKeys.candidatesAll(organizationId, projectId),
          });
          return;
        }
      }
      setFormError(FAILED_MESSAGE);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const rows = candidates.data?.candidates;

  return (
    <Dialog
      data-testid="add-member-dialog"
      size="lg"
      title="เพิ่มสมาชิกเข้าโปรเจกต์"
      description={
        <>
          เลือกจากสมาชิกขององค์กร {organizationName} เพื่อเข้าร่วม {projectName}
        </>
      }
      busy={submitting}
      opener={opener}
      fallbackFocus={fallbackFocus}
      initialFocus={searchInput}
      onClose={cancel}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm sm:px-6">
        {formError === null ? null : (
          <Alert data-testid="add-member-error" tone="error">
            {formError}
          </Alert>
        )}
        <Field htmlFor={searchId} label="ค้นหาสมาชิกองค์กร">
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-foreground-secondary"
            >
              <SearchIcon size={18} />
            </span>
            <Input
              id={searchId}
              data-testid="add-member-search"
              type="search"
              ref={searchInput}
              value={searchText}
              maxLength={100}
              className="pl-10"
              placeholder="ชื่อหรืออีเมล"
              onChange={(event) => {
                setSearchText(event.target.value);
              }}
            />
          </div>
        </Field>
        <p
          data-testid="add-member-result-status"
          role="status"
          className="sr-only"
        >
          {rows === undefined || candidates.isFetching
            ? ""
            : rows.length === 0
              ? "ไม่พบสมาชิกองค์กร"
              : `พบ ${String(rows.length)} คน`}
        </p>
        <div
          role="group"
          aria-label="สมาชิกองค์กร"
          aria-busy={candidates.isFetching ? true : undefined}
          className="max-h-64 min-h-16 overflow-y-auto rounded-md border border-foreground/10"
        >
          {rows === undefined ? (
            candidates.isError ? (
              <div className="flex flex-col items-start gap-2 p-3">
                <Alert data-testid="add-member-candidates-error" tone="error">
                  โหลดรายชื่อสมาชิกองค์กรไม่สำเร็จ
                </Alert>
                <Button
                  data-testid="add-member-candidates-retry"
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void candidates.refetch()}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : (
              <p
                data-testid="add-member-loading"
                role="status"
                className="p-3 text-foreground-secondary"
              >
                กำลังโหลดรายชื่อ…
              </p>
            )
          ) : rows.length === 0 ? (
            <p
              data-testid="add-member-no-match"
              className="p-3 text-foreground-secondary"
            >
              {q === ""
                ? "ไม่พบสมาชิกองค์กร"
                : `ไม่พบสมาชิกองค์กรที่ตรงกับ “${q}” `}
              คนที่ยังไม่อยู่ในองค์กรต้องได้รับคำเชิญเข้าองค์กรก่อน{" "}
              {canManageOrganization ? (
                <Link
                  data-testid="add-member-invite-link"
                  className="text-primary underline-offset-4 hover:underline"
                  to={`/organizations/${organizationId}/members`}
                >
                  เชิญเข้าองค์กร
                </Link>
              ) : (
                <span data-testid="add-member-invite-contact">
                  ติดต่อเจ้าของหรือผู้ดูแลองค์กร
                </span>
              )}
            </p>
          ) : (
            rows.map((candidate) => {
              const noteId = `${hintId}-note-${candidate.userId}`;
              const capped = full && !selected.includes(candidate.userId);
              return (
                <label
                  key={candidate.userId}
                  data-testid={`add-member-row-${candidate.userId}`}
                  className="flex items-center gap-3 border-b border-foreground/10 px-3 py-2 last:border-b-0 has-[:enabled]:cursor-pointer has-[:enabled]:hover:surface-hover"
                >
                  <Checkbox
                    data-testid="add-member-checkbox"
                    checked={selected.includes(candidate.userId)}
                    disabled={capped}
                    aria-describedby={
                      capped ? `${noteId} ${hintId}-limit` : noteId
                    }
                    onChange={() => {
                      toggle(candidate.userId);
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="surface-hover inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-xs font-semibold"
                  >
                    {initialsOf(candidate.name)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      data-testid="add-member-name"
                      className="font-medium break-words"
                    >
                      {candidate.name}
                    </span>
                    <span className="text-[13px] break-all text-foreground-secondary">
                      {candidate.email}
                    </span>
                  </span>
                  <span
                    id={noteId}
                    data-testid="add-member-note"
                    className="shrink-0 text-xs text-foreground-secondary"
                  >
                    {`องค์กร · ${ROLE_LABELS[candidate.organizationRole] ?? candidate.organizationRole}`}
                  </span>
                </label>
              );
            })
          )}
        </div>
        <div>
          <SegmentedControl
            testId="add-member-role"
            optionTestId={(value) => `add-member-role-${value}`}
            label="บทบาทในโปรเจกต์"
            value={role}
            options={ROLE_OPTIONS}
            onChange={setRole}
            disabled={submitting}
          />
          <p
            data-testid="add-member-role-hint"
            className="mt-2 text-xs text-foreground-secondary"
          >
            {PROJECT_ROLE_HINTS[role]}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-foreground/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span aria-live="polite" className="text-sm text-foreground-secondary">
          เลือกแล้ว{" "}
          <span data-testid="add-member-count" className="font-mono">
            {selected.length}
          </span>{" "}
          คน
          {full ? (
            <span id={`${hintId}-limit`} data-testid="add-member-limit">
              {" "}
              · เพิ่มได้ครั้งละไม่เกิน {PROJECT_MEMBER_ADD_MAX} คน
            </span>
          ) : null}
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            data-testid="add-member-cancel"
            type="button"
            variant="secondary"
            wrap
            aria-disabled={submitting ? true : undefined}
            onClick={cancel}
          >
            ยกเลิก
          </Button>
          <Button
            data-testid="add-member-submit"
            type="button"
            wrap
            disabled={selected.length === 0}
            aria-disabled={submitting ? true : undefined}
            aria-busy={submitting ? true : undefined}
            onClick={() => void submit()}
          >
            {submitting ? "กำลังเพิ่ม…" : "เพิ่มสมาชิก"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function staleReasonOf(error: unknown): AddStaleReason | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "PERMISSION_DENIED" || error.code === "MEMBERSHIP_DENIED")
    return "denied";
  if (error.code === "PROJECT_NOT_FOUND") return "not-found";
  return null;
}
