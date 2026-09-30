import type { ComponentProps, ReactNode } from "react";

import { Field, Input, textInputClass } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { cn } from "@/lib/utils";
import { errorId, fieldId, type FieldErrors, type FormValues } from "./model";

/** What each form section gets: the values, the errors placed beside its fields and how to change them. */
export type SectionProps = {
  values: FormValues;
  errors: FieldErrors;
  /** Merges a patch and clears the server errors under `clearPrefix`. */
  onChange: (patch: Partial<FormValues>, clearPrefix: string) => void;
  /** Asks the form to focus an element once the change has rendered. */
  focusAfterRender: (id: string) => void;
  disabled: boolean;
};

const controlInvalid = "aria-invalid:border-danger";

export function TextControl({
  path,
  label,
  ariaLabel,
  error,
  className,
  hint,
  ...props
}: {
  path: string;
  label: ReactNode;
  ariaLabel?: string;
  error: string | undefined;
  className?: string;
  hint?: ReactNode;
} & Omit<ComponentProps<"input">, "id" | "className">) {
  const hintId = `${fieldId(path)}-hint`;
  const describedBy = [
    error === undefined ? null : errorId(path),
    hint === undefined ? null : hintId,
  ]
    .filter((id) => id !== null)
    .join(" ");
  return (
    <div className={className}>
      <Field label={label} error={error} errorId={errorId(path)}>
        <Input
          id={fieldId(path)}
          aria-label={ariaLabel}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          autoComplete="off"
          {...props}
        />
      </Field>
      {hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-xs text-foreground-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectControl({
  path,
  label,
  ariaLabel,
  error,
  className,
  children,
  ...props
}: {
  path: string;
  label: ReactNode;
  ariaLabel?: string;
  error: string | undefined;
  className?: string;
} & Omit<ComponentProps<"select">, "id" | "className">) {
  return (
    <Field
      label={label}
      error={error}
      errorId={errorId(path)}
      className={className}
    >
      <select
        id={fieldId(path)}
        aria-label={ariaLabel}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId(path)}
        className={cn(textInputClass, controlInvalid)}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}

export function TextareaControl({
  path,
  label,
  error,
  className,
  ...props
}: {
  path: string;
  label: ReactNode;
  error: string | undefined;
  className?: string;
} & Omit<ComponentProps<"textarea">, "id" | "className">) {
  return (
    <Field
      label={label}
      error={error}
      errorId={errorId(path)}
      className={className}
    >
      <textarea
        id={fieldId(path)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId(path)}
        className={cn(
          textInputClass,
          controlInvalid,
          "h-auto min-h-32 py-2 font-mono text-sm",
        )}
        spellCheck={false}
        {...props}
      />
    </Field>
  );
}

/** One editable row: a legend and remove button that name the row, so a screen reader hears which one. */
export function RowShell({
  legend,
  removeLabel,
  onRemove,
  disabled,
  children,
}: {
  legend: string;
  removeLabel: string;
  onRemove?: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-foreground/10 p-3">
      <legend className="px-1 text-xs text-foreground-secondary">
        {legend}
      </legend>
      {children}
      {onRemove === undefined ? null : (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={removeLabel}
            onClick={onRemove}
          >
            ลบ
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/** Add button with its limit message beside it (AC-16). */
export function AddRowButton({
  id,
  label,
  limitMessage,
  onAdd,
  disabled,
}: {
  id: string;
  label: string;
  limitMessage: string | null;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        id={id}
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        aria-describedby={limitMessage === null ? undefined : `${id}-limit`}
        onClick={onAdd}
      >
        {label}
      </Button>
      {limitMessage === null ? null : (
        <span id={`${id}-limit`} role="alert" className="text-sm text-danger">
          {limitMessage}
        </span>
      )}
    </div>
  );
}
