import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";

import { Field, Input, textInputClass } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { cn } from "@/lib/utils";
import { errorId, fieldId, type FieldErrors, type FormValues } from "./model";
import type { SecretAccess } from "./secrets";

/** What each form section gets: the values, the errors placed beside its fields and how to change them. */
export type SectionProps = {
  values: FormValues;
  errors: FieldErrors;
  /** Merges a patch and clears the server errors under `clearPrefix`. */
  onChange: (patch: Partial<FormValues>, clearPrefix: string) => void;
  /** Asks the form to focus an element once the change has rendered. */
  focusAfterRender: (id: string) => void;
  disabled: boolean;
  /** Secret values are read and written here, never through `values`. */
  secrets: SecretAccess;
};

const controlInvalid = "aria-invalid:border-danger";

export function TextControl({
  path,
  label,
  ariaLabel,
  error,
  className,
  hint,
  disabled,
  ...props
}: {
  path: string;
  label: ReactNode;
  ariaLabel?: string;
  error: string | undefined;
  className?: string;
  hint?: ReactNode;
  /** Read-only, not natively disabled: a disabled field would drop the focus its user is typing in. */
  disabled?: boolean;
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
          readOnly={disabled === true}
          aria-readonly={disabled === true ? true : undefined}
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

/**
 * A write-only secret field. It is uncontrolled: a controlled input would copy
 * the value into the DOM `value` attribute. The text is kept in the secret
 * store and put back through the `value` property when the field mounts or is cleared.
 */
export function SecretControl({
  path,
  slot,
  label,
  ariaLabel,
  error,
  hint,
  disabled,
  secrets,
  onType,
}: {
  path: string;
  slot: string;
  label: ReactNode;
  ariaLabel?: string;
  error: string | undefined;
  hint?: ReactNode;
  disabled: boolean;
  secrets: SecretAccess;
  /** Called with the slot's path after each keystroke, to clear an error beside it. */
  onType: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { get, set, version } = secrets;
  useEffect(() => {
    const input = ref.current;
    if (input !== null && input.value !== get(slot)) input.value = get(slot);
  }, [get, slot, version]);
  const hintId = `${fieldId(path)}-hint`;
  const describedBy = [
    error === undefined ? null : errorId(path),
    hint === undefined ? null : hintId,
  ]
    .filter((id) => id !== null)
    .join(" ");
  return (
    <div>
      <Field label={label} error={error} errorId={errorId(path)}>
        <Input
          ref={ref}
          id={fieldId(path)}
          type="password"
          autoComplete="new-password"
          aria-label={ariaLabel}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          readOnly={disabled}
          aria-readonly={disabled ? true : undefined}
          spellCheck={false}
          onChange={(event) => {
            set(slot, event.target.value);
            onType();
          }}
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
  disabled,
  onChange,
  ...props
}: {
  path: string;
  label: ReactNode;
  ariaLabel?: string;
  error: string | undefined;
  className?: string;
  disabled?: boolean;
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
        aria-disabled={disabled === true ? true : undefined}
        onChange={(event) => {
          if (disabled !== true) onChange?.(event);
        }}
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
  disabled,
  ...props
}: {
  path: string;
  label: ReactNode;
  error: string | undefined;
  className?: string;
  disabled?: boolean;
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
        readOnly={disabled === true}
        aria-readonly={disabled === true ? true : undefined}
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
            aria-disabled={disabled}
            aria-label={removeLabel}
            onClick={() => {
              if (!disabled) onRemove();
            }}
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
        aria-disabled={disabled}
        aria-describedby={limitMessage === null ? undefined : `${id}-limit`}
        onClick={() => {
          if (!disabled) onAdd();
        }}
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
