import type { ProjectRole } from "@nightwatch/api-contract";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { SearchIcon } from "../../../components/shell/icons";
import { Alert, Input } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
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
const FOCUSABLE = [
  "a[href]",
  'button:not(:disabled):not([tabindex="-1"])',
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(",");

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

/** Picks Organization members (never outsiders, AC-01) and adds them with one role. */
export function AddMemberDialog({
  organizationId,
  organizationName,
  projectId,
  projectName,
  opener,
  fallbackFocus,
  memberIds,
  onAdded,
  onCancel,
  onStale,
}: {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  /** Who was in the Project when the dialog's request was built. */
  memberIds: readonly string[];
  onAdded: (result: AddResult) => Promise<void>;
  onCancel: () => void;
  onStale: (reason: AddStaleReason) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const searchId = useId();
  const hintId = useId();
  const dialog = useRef<HTMLDivElement>(null);
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
    searchInput.current?.focus();
    const fallback = fallbackFocus.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        dialog.current?.contains(event.target) === false
      ) {
        searchInput.current?.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (opener?.isConnected === true) opener.focus();
      else fallback?.focus();
    };
  }, [opener, fallbackFocus]);

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
      const { members } = await addProjectMembers(organizationId, projectId, {
        userIds: selected,
        role,
      });
      const before = new Set(memberIds);
      const after = new Set(members.map((member) => member.userId));
      const added = selected.filter(
        (id) => !before.has(id) && after.has(id),
      ).length;
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first === undefined || last === undefined) return;
    const outside = dialog.current?.contains(document.activeElement) !== true;
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || outside)
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const rows = candidates.data?.candidates;

  return createPortal(
    <div className="backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        ref={dialog}
        data-testid="add-member-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={submitting ? true : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="overlay-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-[560px] flex-col rounded-md border border-foreground/10 bg-surface text-foreground shadow-modal focus:outline-none"
      >
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <h2 id={titleId} className="text-lg font-semibold text-heading">
            เพิ่มสมาชิกเข้าโปรเจกต์
          </h2>
          <p
            id={descriptionId}
            className="mt-1 text-sm break-words text-foreground-secondary"
          >
            เลือกจากสมาชิกขององค์กร {organizationName} เพื่อเข้าร่วม{" "}
            {projectName}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm sm:px-6">
          {formError === null ? null : (
            <Alert data-testid="add-member-error" tone="error">
              {formError}
            </Alert>
          )}
          <div>
            <Label htmlFor={searchId} className="mb-2 block font-medium">
              ค้นหาสมาชิกองค์กร
            </Label>
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
          </div>
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
                    ลองอีกครั้ง
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
                คนที่ยังไม่อยู่ในองค์กรต้องได้รับคำเชิญเข้าองค์กรก่อน
              </p>
            ) : (
              rows.map((candidate) => {
                const inProject = candidate.projectRole !== null;
                const noteId = `${hintId}-note-${candidate.userId}`;
                return (
                  <label
                    key={candidate.userId}
                    data-testid={`add-member-row-${candidate.userId}`}
                    className="flex items-center gap-3 border-b border-foreground/10 px-3 py-2 last:border-b-0 has-[:enabled]:cursor-pointer has-[:enabled]:hover:surface-hover"
                  >
                    <input
                      data-testid="add-member-checkbox"
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={
                        !inProject && selected.includes(candidate.userId)
                      }
                      disabled={inProject}
                      aria-describedby={noteId}
                      onChange={() => {
                        toggle(candidate.userId);
                      }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        data-testid="add-member-name"
                        className={
                          inProject
                            ? "break-words text-foreground-secondary"
                            : "font-medium break-words"
                        }
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
                      {candidate.projectRole === null
                        ? `องค์กร · ${ROLE_LABELS[candidate.organizationRole] ?? candidate.organizationRole}`
                        : `อยู่ในโปรเจกต์แล้ว · ${PROJECT_ROLE_LABELS[candidate.projectRole]}`}
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
          <span
            aria-live="polite"
            className="text-sm text-foreground-secondary"
          >
            เลือกแล้ว{" "}
            <span data-testid="add-member-count" className="font-mono">
              {selected.length}
            </span>{" "}
            คน
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
      </div>
    </div>,
    document.body,
  );
}

function staleReasonOf(error: unknown): AddStaleReason | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "PERMISSION_DENIED" || error.code === "MEMBERSHIP_DENIED")
    return "denied";
  if (error.code === "PROJECT_NOT_FOUND") return "not-found";
  return null;
}
