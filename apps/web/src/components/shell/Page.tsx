import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";
import { StatusPill } from "../ui/status-pill";
import { initialsOf } from "./initials";

// Data pages fill the main column; forms cap at 720 px so a line of copy stays under 80 characters.
export function Page({
  width = "fluid",
  className,
  children,
}: {
  width?: "fluid" | "form";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-6",
        width === "form" && "max-w-[720px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type PageScope = {
  /** Name the mark's initials come from; omitted for a bare label. */
  mark?: string;
  /** Organizations are system objects (4 px corner); people get a circle (LAY-05). */
  markShape?: "org" | "person";
  label: ReactNode;
  /** Role or context, shown as a neutral pill. */
  tag?: ReactNode;
};

function ScopeMark({ name, shape }: { name: string; shape: "org" | "person" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center border border-foreground/10 bg-surface text-[10px] font-semibold text-foreground",
        shape === "person" ? "rounded-full" : "rounded-[3px]",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

// Scope row (who or what the page acts on), title, then a status line for
// facts: slug, counts, freshness. Facts sit in sans at 12 px; callers wrap
// identifiers and numbers in `font-mono`. No letter tracking: Thai text.
export function PageHeader({
  scope,
  title,
  status,
  description,
  actions,
  titleRef,
  titleTabIndex,
  titleClassName,
}: {
  scope?: PageScope;
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTabIndex?: number;
  titleClassName?: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="min-w-0">
        {scope === undefined ? null : (
          <p className="flex min-w-0 items-center gap-2 text-xs text-foreground-secondary">
            {scope.mark === undefined ? null : (
              <ScopeMark name={scope.mark} shape={scope.markShape ?? "org"} />
            )}
            <span className="truncate">{scope.label}</span>
            {scope.tag === undefined ? null : (
              <StatusPill tone="muted">{scope.tag}</StatusPill>
            )}
          </p>
        )}
        <h1
          className={cn(
            "mt-2 text-2xl leading-8 font-semibold",
            titleClassName,
          )}
          ref={titleRef}
          tabIndex={titleTabIndex}
        >
          {title}
        </h1>
        {status === undefined ? null : (
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary">
            {status}
          </p>
        )}
        {description === undefined ? null : (
          <p className="mt-2 text-sm text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
