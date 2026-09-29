import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Decorative icon square on the inset surface; the row's text carries the meaning.
function IconTile({
  className,
  size = 40,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & {
  size?: 32 | 40;
  tone?: "neutral" | "positive";
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="icon-tile"
      className={cn(
        "surface-inset inline-flex shrink-0 items-center justify-center rounded-md border border-foreground/10",
        size === 32 ? "h-8 w-8" : "h-10 w-10",
        tone === "positive" ? "text-primary" : "text-foreground-secondary",
        className,
      )}
      {...props}
    />
  );
}

export { IconTile };
