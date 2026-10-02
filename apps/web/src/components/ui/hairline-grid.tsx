import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Sibling stats or rows separated by 1 px Divider gaps, cells on Surface
 * (design-system Layout). The caller sets the columns, e.g.
 * `className="grid-cols-2 lg:grid-cols-4"`; every direct child is a cell.
 */
export function HairlineGrid({
  as: Tag = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "ul" | "ol" | "dl";
}) {
  return (
    <Tag
      data-slot="hairline-grid"
      className={cn(
        "grid gap-px overflow-hidden rounded-md border border-foreground/10 bg-foreground/10 *:bg-surface",
        className,
      )}
      {...props}
    />
  );
}
