import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Column for every routed page inside the AppShell: one content width for
 * forms and detail views (960px, left-aligned like the reference renders)
 * and one vertical rhythm between header and sections.
 */
export function Page({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full max-w-[960px] flex-col gap-6", className)}>
      {children}
    </div>
  );
}

/**
 * The reference page header: a small scope line (organization, account),
 * the page title, an optional one-line description and the page's actions
 * on the right (docs/design-system.md, Layout: clear title, scope, one
 * dominant next action). No tracking on the title: it is Thai text.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow === undefined ? null : (
          <p className="text-xs text-foreground-secondary">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
