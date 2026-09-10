import type { ReactNode } from "react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";

/**
 * NightWatch primitives, composed from shadcn/ui base components
 * (src/components/ui/*, generated per components.json). Pages keep
 * importing from this barrel; NODE-6+ may use the shadcn pieces directly.
 */
export { Input } from "./ui/input";

/**
 * Shared class for non-Input controls (e.g. the workspace role <select>)
 * that take the same field styling; text inputs use <Input> instead.
 */
export const textInputClass =
  "w-full rounded-md border border-control-border bg-surface px-3 py-2 text-foreground " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Centered single-card page used by every auth form (docs/design-system.md). */
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
    <main className="flex min-h-screen items-center justify-center p-4">
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
  children,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <Label className="block">
      <span className="mb-1 block">{label}</span>
      {children}
      {error === undefined || error === null ? null : (
        <span role="alert" className="mt-1 block text-sm text-danger">
          {error}
        </span>
      )}
    </Label>
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
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  const className =
    tone === "error"
      ? // Soft danger-tinted wash instead of the flat page background: the
        // tint alone signals "error state" even at a glance, while icon/text
        // stay the only fully-saturated danger color (docs/design-system.md).
        "border-danger/40 bg-danger/8 text-danger"
      : tone === "success"
        ? "border-primary/40 bg-background text-primary"
        : "border-control-border bg-background text-foreground-secondary";
  return (
    <p
      role="alert"
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
