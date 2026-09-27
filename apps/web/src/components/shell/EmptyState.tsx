import type { ReactNode } from "react";

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
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-foreground/10 px-6 py-8 text-center">
      {icon === undefined ? null : (
        <span className="text-foreground-secondary">{icon}</span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-sm text-sm text-foreground-secondary">
          {description}
        </p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
