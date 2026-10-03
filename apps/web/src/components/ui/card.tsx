import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

// Depth comes from Canvas/Surface, never a shadow; shadows are reserved for floating overlays.
const cardVariants = cva(
  "flex flex-col rounded-md border border-foreground/10 bg-surface text-foreground",
  {
    variants: {
      padding: { none: "", md: "gap-6 p-6" },
    },
    defaultVariants: { padding: "none" },
  },
);

function Card({
  className,
  padding,
  as: Tag = "div",
  ...props
}: ComponentProps<"div"> &
  VariantProps<typeof cardVariants> & { as?: "div" | "section" | "article" }) {
  return (
    <Tag
      data-slot="card"
      className={cn(cardVariants({ padding }), className)}
      {...props}
    />
  );
}

function CardHeader({
  id,
  title,
  description,
  action,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-col items-start gap-4 sm:flex-row sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-heading">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

const cardFooterVariants = cva("border-t border-foreground/10 pt-4", {
  variants: {
    variant: {
      end: "flex items-center justify-end gap-2",
      split: "flex flex-wrap items-center justify-between gap-3",
      stack: "flex flex-col gap-3",
    },
  },
  defaultVariants: { variant: "end" },
});

function CardFooter({
  className,
  variant,
  hint,
  children,
  ...props
}: ComponentProps<"div"> &
  VariantProps<typeof cardFooterVariants> & { hint?: ReactNode }) {
  return (
    <div
      data-slot="card-footer"
      className={cn(cardFooterVariants({ variant }), className)}
      {...props}
    >
      {hint === undefined ? null : (
        <p className="text-xs text-foreground-secondary">{hint}</p>
      )}
      {children}
    </div>
  );
}

// One section inside a grouped Card (`divide-y divide-foreground/10`): the
// page-card inset without its own border, so related sections share a frame.
function CardSection({
  className,
  as: Tag = "section",
  ...props
}: ComponentProps<"div"> & { as?: "section" | "div" }) {
  return (
    <Tag
      data-slot="card-section"
      className={cn("flex flex-col gap-6 p-6", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardSection };
