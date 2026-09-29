import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Decorative icon square in the Primary tint; the row's text carries the meaning.
function IconTile({
  className,
  size = 40,
  ...props
}: ComponentProps<"span"> & {
  size?: 32 | 40;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="icon-tile"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/12 text-primary",
        size === 32 ? "h-8 w-8" : "h-10 w-10",
        className,
      )}
      {...props}
    />
  );
}

export { IconTile };
