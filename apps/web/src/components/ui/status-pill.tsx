import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Neutral Surface with coloured text or dot, never a coloured fill (COL-01).
const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-surface px-2 py-0.5 text-xs",
  {
    variants: {
      tone: {
        neutral: "text-foreground",
        muted: "text-foreground-secondary",
        primary: "font-medium text-primary",
        caution: "font-medium text-caution",
        danger: "font-medium text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function StatusPill({
  className,
  tone,
  dot = false,
  children,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof statusPillVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="status-pill"
      className={cn(statusPillVariants({ tone }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "neutral" ? "bg-foreground-secondary" : "bg-current",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export { StatusPill };
