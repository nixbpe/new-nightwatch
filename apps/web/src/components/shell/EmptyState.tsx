import type { ReactNode } from "react";

/**
 * Reusable empty-state primitive (Step 7 hardening), matching
 * docs/design-system.md's Feedback rule: "Distinguish loading, no data, no
 * filter matches... Unknown/stale data must not look healthy, current or
 * empty." Provided as shell-level scaffolding — no existing page is
 * rewritten to use it (out of scope: "layout and navigation only, no page
 * content"), but any page's genuine no-data state can reach for this
 * instead of inventing its own each time.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-control-border/40 px-6 py-10 text-center">
      {icon === undefined ? null : (
        <span className="text-foreground-secondary">{icon}</span>
      )}
      <p className="font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-sm text-sm text-foreground-secondary">
          {description}
        </p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
