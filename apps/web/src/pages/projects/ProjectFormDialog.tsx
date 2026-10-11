import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  type ProjectSummary,
} from "@nightwatch/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Alert, Field, Input, textInputClass } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import {
  createProject,
  projectQueryKeys,
  updateProject,
} from "../../lib/api/projects";
import { cn } from "../../lib/utils";

const FOCUSABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export const SLUG_TAKEN_MESSAGE = "slug นี้ถูกใช้แล้วในองค์กร";
export const LIMIT_REACHED_MESSAGE =
  "องค์กรมีโปรเจกต์ครบ 50 โปรเจกต์แล้ว ลบโปรเจกต์ที่ไม่ใช้ก่อนสร้างใหม่";
const FAILED_MESSAGE = "บันทึกไม่สำเร็จ ลองอีกครั้ง";
const NAME_MESSAGE = "ใส่ชื่อโปรเจกต์ 1 ถึง 80 ตัวอักษร";
const SLUG_MESSAGE = "slug ยาว 3 ถึง 40 ตัว ใช้ a-z, 0-9 และ - เท่านั้น";
const DESCRIPTION_MESSAGE = "คำอธิบายยาวไม่เกิน 500 ตัวอักษร";

type FieldName = "name" | "slug" | "description";
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_MESSAGES: Record<FieldName, string> = {
  name: NAME_MESSAGE,
  slug: SLUG_MESSAGE,
  description: DESCRIPTION_MESSAGE,
};

function toFieldErrors(
  issues: readonly { path: readonly PropertyKey[] }[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (key === "name" || key === "slug" || key === "description") {
      errors[key] = FIELD_MESSAGES[key];
    }
  }
  return errors;
}

/** Create and edit share one modal; the slug is fixed after creation (AC-03). */
export function ProjectFormDialog({
  organizationId,
  project,
  opener,
  fallbackFocus,
  onSaved,
  onCancel,
  onStale,
}: {
  organizationId: string;
  /** Present when editing. */
  project?: ProjectSummary;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  onSaved: (saved: ProjectSummary) => void;
  onCancel: () => void;
  /** The role or the project changed under the user: close and reload the list. */
  onStale: () => void;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const nameId = useId();
  const slugId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLFormElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const slugInput = useRef<HTMLInputElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const editing = project !== undefined;
  const [name, setName] = useState(project?.name ?? "");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState(project?.description ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slugFocusToken, setSlugFocusToken] = useState(0);

  useEffect(() => {
    nameInput.current?.focus();
    const fallback = fallbackFocus.current;
    const keepFocusInside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        dialog.current?.contains(event.target) === false
      ) {
        nameInput.current?.focus();
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
    if (slugFocusToken > 0) slugInput.current?.focus();
  }, [slugFocusToken]);

  const cancel = () => {
    if (!inFlight.current) onCancel();
  };

  const stale = () => {
    void queryClient.invalidateQueries({
      queryKey: projectQueryKeys.all(organizationId),
    });
    onStale();
  };

  const handleError = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      setFormError(FAILED_MESSAGE);
      return;
    }
    switch (error.code) {
      case "PROJECT_SLUG_TAKEN":
        // Every field keeps its value; only the slug is marked.
        setErrors({ slug: SLUG_TAKEN_MESSAGE });
        setSlugFocusToken((token) => token + 1);
        return;
      case "PROJECT_LIMIT_REACHED":
        setFormError(LIMIT_REACHED_MESSAGE);
        return;
      case "PERMISSION_DENIED":
      case "MEMBERSHIP_DENIED":
      case "PROJECT_NOT_FOUND":
        stale();
        return;
      default:
        setFormError(FAILED_MESSAGE);
    }
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    setFormError(null);
    const parsed = editing
      ? updateProjectRequestSchema.safeParse({ name, description })
      : createProjectRequestSchema.safeParse({ name, slug, description });
    if (!parsed.success) {
      const found = toFieldErrors(parsed.error.issues);
      setErrors(found);
      const first =
        found.name !== undefined
          ? nameInput
          : found.slug !== undefined
            ? slugInput
            : descriptionInput;
      first.current?.focus();
      return;
    }
    setErrors({});
    inFlight.current = true;
    setSubmitting(true);
    try {
      const saved = editing
        ? await updateProject(organizationId, project.id, { name, description })
        : await createProject(organizationId, { name, slug, description });
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.all(organizationId),
      });
      onSaved(saved);
    } catch (error) {
      handleError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
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

  return createPortal(
    <div className="backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <form
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={submitting ? true : undefined}
        noValidate
        onSubmit={(event) => void submit(event)}
        onKeyDown={onKeyDown}
        className="overlay-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-[520px] flex-col rounded-md border border-foreground/10 bg-surface text-foreground shadow-modal focus:outline-none"
      >
        <h2
          id={titleId}
          className="px-4 pt-4 text-lg font-semibold text-heading sm:px-6 sm:pt-6"
        >
          {editing ? `แก้ไขโปรเจกต์ ${project.name}` : "สร้างโปรเจกต์"}
        </h2>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm sm:px-6">
          {formError === null ? null : <Alert tone="error">{formError}</Alert>}
          <Field label="ชื่อโปรเจกต์" error={errors.name} errorId={nameId}>
            <Input
              ref={nameInput}
              value={name}
              aria-invalid={errors.name === undefined ? undefined : true}
              aria-describedby={errors.name === undefined ? undefined : nameId}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          {editing ? (
            <div>
              <span className="mb-2 block font-medium">slug</span>
              <span className="font-mono text-[13px]">{project.slug}</span>
              <span className="mt-1 block text-xs text-foreground-secondary">
                slug เปลี่ยนไม่ได้หลังสร้าง
              </span>
            </div>
          ) : (
            <div>
              <Field label="slug" error={errors.slug} errorId={slugId}>
                <Input
                  ref={slugInput}
                  value={slug}
                  className="font-mono text-[13px]"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={errors.slug === undefined ? undefined : true}
                  aria-describedby={
                    errors.slug === undefined ? `${slugId}-hint` : slugId
                  }
                  onChange={(event) => {
                    setSlug(event.target.value);
                  }}
                />
              </Field>
              <span
                id={`${slugId}-hint`}
                className="mt-1 block text-xs text-foreground-secondary"
              >
                3 ถึง 40 ตัว ใช้ a-z, 0-9 และ - เท่านั้น เปลี่ยนไม่ได้หลังสร้าง
              </span>
            </div>
          )}
          <div>
            <Field
              label="คำอธิบาย (ไม่บังคับ)"
              error={errors.description}
              errorId={descriptionId}
            >
              <textarea
                ref={descriptionInput}
                value={description}
                rows={3}
                className={cn(textInputClass, "h-auto py-2")}
                aria-invalid={
                  errors.description === undefined ? undefined : true
                }
                aria-describedby={
                  errors.description === undefined
                    ? `${descriptionId}-hint`
                    : descriptionId
                }
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </Field>
            <span
              id={`${descriptionId}-hint`}
              className="mt-1 block text-xs text-foreground-secondary"
            >
              ไม่เกิน 500 ตัวอักษร
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-foreground/10 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="secondary"
            wrap
            aria-disabled={submitting ? true : undefined}
            onClick={cancel}
          >
            ยกเลิก
          </Button>
          <Button
            type="submit"
            wrap
            aria-disabled={submitting ? true : undefined}
            aria-busy={submitting ? true : undefined}
          >
            {submitting ? "กำลังบันทึก…" : editing ? "บันทึก" : "สร้างโปรเจกต์"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
