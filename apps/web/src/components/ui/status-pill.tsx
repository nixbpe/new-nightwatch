import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Neutral Surface behind a strong edge (Text 20%); the tone colours text or
// dot, never the fill (COL-01).
const statusPillVariants = cva(
  "inline-flex h-[22px] items-center gap-1.5 rounded-full border border-foreground/20 bg-surface px-2.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "text-foreground",
        muted: "text-foreground-secondary",
        primary: "text-primary",
        caution: "text-caution",
        danger: "text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const DOT_TONES = {
  neutral: "bg-foreground-secondary",
  muted: "bg-foreground-secondary",
  primary: "bg-primary",
  caution: "bg-caution",
  danger: "bg-danger",
} as const;

/**
 * `dot` adds a leading dot in the tone's role. `neutralLabel` keeps the label
 * in Text and leaves the tone to the dot alone (the canvas status pill); it
 * implies `dot`, and the written label still carries the state.
 */
function StatusPill({
  className,
  tone,
  dot = false,
  neutralLabel = false,
  children,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof statusPillVariants> & {
    dot?: boolean;
    neutralLabel?: boolean;
  }) {
  const role = tone ?? "neutral";
  return (
    <span
      data-slot="status-pill"
      className={cn(
        statusPillVariants({ tone: neutralLabel ? "neutral" : role }),
        className,
      )}
      {...props}
    >
      {dot || neutralLabel ? (
        <span
          aria-hidden="true"
          className={cn(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            DOT_TONES[role],
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export { StatusPill };
