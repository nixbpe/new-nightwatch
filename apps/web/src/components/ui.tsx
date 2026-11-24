import type { ReactNode } from "react";

import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from "./shell/icons";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

export { Input } from "./ui/input";

// For non-Input controls (e.g. <select>) that share the field styling.
export const textInputClass =
  "h-10 w-full rounded-md border border-control-border bg-surface px-3 text-base font-normal text-foreground " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function Field({
  label,
  error,
  errorId,
  errorTestId,
  className,
  children,
}: {
  label: ReactNode;
  error?: string | null;
  /** Lets the control point at the message through aria-describedby. */
  errorId?: string;
  errorTestId?: string;
  className?: string;
  children: ReactNode;
}) {
  // The message sits outside the <label> so the accessible label stays the label text alone.
  return (
    <div className={className}>
      <Label className="block">
        <span className="mb-2 block">{label}</span>
        {children}
      </Label>
      {error === undefined || error === null ? null : (
        <span
          data-testid={errorTestId}
          id={errorId}
          role="alert"
          className="mt-1 block text-sm text-danger"
        >
          {error}
        </span>
      )}
    </div>
  );
}

export function FieldValidationError({
  id,
  errors,
  "data-testid": testId,
}: {
  "data-testid"?: string;
  id: string;
  errors: readonly unknown[];
}) {
  const first = errors[0];
  const message =
    typeof first === "string"
      ? first
      : first != null &&
          typeof first === "object" &&
          "message" in first &&
          typeof first.message === "string"
        ? first.message
        : null;
  return message === null ? null : (
    <span
      data-testid={testId}
      id={id}
      role="alert"
      className="mt-1 block text-sm text-danger"
    >
      {message}
    </span>
  );
}

export function SubmitButton({
  pending,
  pendingLabel,
  disabled,
  variant,
  "data-testid": testId,
  children,
}: {
  "data-testid"?: string;
  pending: boolean;
  pendingLabel: string;
  disabled?: boolean;
  variant?: "default" | "secondary";
  children: ReactNode;
}) {
  return (
    <Button
      data-testid={testId}
      type="submit"
      variant={variant}
      disabled={pending || disabled === true}
      className="w-full"
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

const ALERT_ICONS = {
  error: AlertCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
} as const;

export function Alert({
  id,
  tone,
  role,
  "data-testid": testId,
  children,
}: {
  "data-testid"?: string;
  id?: string;
  tone: "error" | "warning" | "info";
  /** Defaults to `alert` for an error, `status` otherwise, so a persistent caution is not announced assertively. */
  role?: "alert" | "status";
  children: ReactNode;
}) {
  // Text stays the only fully-saturated use of the tone colour; info is neutral by design.
  const className =
    tone === "error"
      ? "border-danger/25 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-caution/25 bg-caution/10 text-caution"
        : "border-foreground/15 bg-foreground/4 text-foreground";
  const Icon = ALERT_ICONS[tone];
  return (
    <div
      data-testid={testId}
      id={id}
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${className}`}
    >
      <span className="flex h-5 shrink-0 items-center">
        <Icon />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FullPageLoading({
  label,
  "data-testid": testId,
}: {
  label: string;
  "data-testid"?: string;
}) {
  return (
    <main
      data-testid={testId}
      className="flex min-h-screen items-center justify-center p-4"
    >
      <p role="status" className="text-foreground-secondary">
        {label}
      </p>
    </main>
  );
}
