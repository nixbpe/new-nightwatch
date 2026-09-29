import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { IconTile } from "../ui/icon-tile";

// One composition for every empty view: icon tile, one title, one line, one
// action. `first-run` gives the overview's first visit more room to breathe.
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "default",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "default" | "first-run";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-foreground/10 bg-surface px-6 text-center",
        variant === "first-run" ? "py-12" : "py-8",
      )}
    >
      {icon === undefined ? null : <IconTile size={40}>{icon}</IconTile>}
      <p className="text-base font-semibold">{title}</p>
      {description === undefined ? null : (
        <p
          className={cn(
            "text-sm text-foreground-secondary",
            variant === "first-run" ? "max-w-[560px]" : "max-w-sm",
          )}
        >
          {description}
        </p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
