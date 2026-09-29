import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Inline result line under a card footer: success or pending, announced as a status.
function Notice({
  tone,
  className,
  children,
}: {
  tone: "success" | "pending";
  className?: string;
  children?: ReactNode;
}) {
  if (children === undefined || children === null || children === false) {
    return null;
  }
  return (
    <p
      role="status"
      data-slot="notice"
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        tone === "success" ? "text-primary" : "text-foreground-secondary",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "success" ? "bg-current" : "animate-pulse bg-current",
        )}
      />
      {children}
    </p>
  );
}

export { Notice };
