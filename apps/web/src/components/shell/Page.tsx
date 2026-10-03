import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";
import { StatusPill } from "../ui/status-pill";
import { initialsFontClass, initialsOf } from "./initials";

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

// Same marks as the sidebar: an organization is solid Primary with On primary
// initials; a person is the inset avatar with a strong edge.
function ScopeMark({ name, shape }: { name: string; shape: "org" | "person" }) {
  const initials = initialsOf(name);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center text-[9px] font-semibold",
        initialsFontClass(initials),
        shape === "person"
          ? "surface-hover rounded-full border border-foreground/20 text-foreground"
          : "rounded-[3px] bg-primary text-on-primary",
      )}
    >
      {initials}
    </span>
  );
}

// TYP-04: eyebrow is a Latin route code such as `// overview`.
// Labels stay Thai sans without tracking; callers wrap status values in `font-mono`.
export function PageHeader({
  eyebrow,
  scope,
  title,
  status,
  description,
  actions,
  titleRef,
  titleTabIndex,
  titleClassName,
}: {
  /** Latin route code only; rendered outside the h1 so the heading name stays the title. */
  eyebrow?: string;
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
          <p className="flex min-w-0 items-center gap-2 text-[13px] text-foreground-secondary">
            {scope.mark === undefined ? null : (
              <ScopeMark name={scope.mark} shape={scope.markShape ?? "org"} />
            )}
            <span className="truncate">{scope.label}</span>
            {scope.tag === undefined ? null : (
              <StatusPill>{scope.tag}</StatusPill>
            )}
          </p>
        )}
        {eyebrow === undefined ? null : (
          <p
            className={cn(
              "font-mono text-xs font-medium tracking-[0.12em] text-primary uppercase",
              scope === undefined ? "" : "mt-5",
            )}
          >
            {eyebrow}
          </p>
        )}
        <h1
          className={cn(
            "mt-2.5 text-[28px] leading-9 font-semibold text-heading",
            titleTabIndex !== undefined &&
              "w-fit max-w-full rounded-[4px] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            titleClassName,
          )}
          ref={titleRef}
          tabIndex={titleTabIndex}
        >
          {title}
        </h1>
        {status === undefined ? null : (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-xs text-foreground-secondary [&_.font-mono]:font-medium [&_.font-mono]:text-foreground">
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
