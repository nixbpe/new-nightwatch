import type { ReactNode } from "react";

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
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle === undefined ? null : (
          <p className="mt-2 text-sm text-foreground-secondary">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </div>
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
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error === undefined || error === null ? null : (
        <span role="alert" className="mt-1 block text-sm text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

export const textInputClass =
  "w-full rounded-md border border-control-border bg-surface px-3 py-2 text-foreground " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-60";

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
    <button
      type="submit"
      disabled={pending || disabled === true}
      className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
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
      ? "border-danger/40 text-danger"
      : tone === "success"
        ? "border-primary/40 text-primary"
        : "border-control-border text-foreground-secondary";
  return (
    <p
      role="alert"
      className={`rounded-md border bg-background px-3 py-2 text-sm ${className}`}
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
