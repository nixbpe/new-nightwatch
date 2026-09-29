import type { ReactNode } from "react";

import { BrandMark } from "./shell/BrandMark";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";

export { Input } from "./ui/input";

// For non-Input controls (e.g. <select>) that share the field styling.
export const textInputClass =
  "h-10 w-full rounded-md border border-control-border bg-surface px-3 text-base font-normal text-foreground " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function AuthPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <BrandMark withName />
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle === undefined ? null : (
          <p className="mt-2 text-sm text-foreground-secondary">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </Card>
    </main>
  );
}

export function Field({
  label,
  error,
  errorId,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  /** Lets the control point at the message through aria-describedby. */
  errorId?: string;
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
}: {
  id: string;
  errors: readonly unknown[];
}) {
  const first = errors[0];
  if (typeof first === "string") {
    return (
      <span id={id} role="alert" className="mt-1 block text-sm text-danger">
        {first}
      </span>
    );
  }
  if (
    first != null &&
    typeof first === "object" &&
    "message" in first &&
    typeof first.message === "string"
  ) {
    return (
      <span id={id} role="alert" className="mt-1 block text-sm text-danger">
        {first.message}
      </span>
    );
  }
  return null;
}

export function SubmitButton({
  pending,
  pendingLabel,
  disabled,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      disabled={pending || disabled === true}
      className="w-full"
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function Alert({
  tone,
  role = "alert",
  children,
}: {
  tone: "error" | "success" | "warning" | "info";
  /** `status` for outcomes that inform without interrupting (a sent invitation). */
  role?: "alert" | "status";
  children: ReactNode;
}) {
  // Text stays the only fully-saturated use of the tone colour; info is neutral by design.
  const className =
    tone === "error"
      ? "border-danger/40 bg-danger/8 text-danger"
      : tone === "success"
        ? "border-primary/40 bg-primary/8 text-primary"
        : tone === "warning"
          ? "border-caution/40 bg-caution/8 text-caution"
          : "border-foreground/15 bg-foreground/4 text-foreground";
  return (
    <p
      role={role}
      className={`rounded-md border px-3 py-2 text-sm ${className}`}
    >
      {children}
    </p>
  );
}

export function FullPageLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <p role="status" className="text-foreground-secondary">
        {label}
      </p>
    </main>
  );
}
