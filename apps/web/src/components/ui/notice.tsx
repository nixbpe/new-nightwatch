import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function Notice({
  tone,
  className,
  children,
  "data-testid": testId,
}: {
  "data-testid"?: string;
  tone: "success" | "pending";
  className?: string;
  children?: ReactNode;
}) {
  if (children === undefined || children === null || children === false) {
    return null;
  }
  return (
    <p
      data-testid={testId}
      role="status"
      data-slot="notice"
      className={cn(
        "inline-flex items-start gap-1.5 text-sm",
        tone === "success" ? "text-primary" : "text-foreground-secondary",
        className,
      )}
    >
      {/* Centred on the first line, so the dot keeps its shape when the text wraps. */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-[calc((1lh-0.375rem)/2)] h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "success" ? "bg-current" : "animate-pulse bg-current",
        )}
      />
      {children}
    </p>
  );
}

export { Notice };
