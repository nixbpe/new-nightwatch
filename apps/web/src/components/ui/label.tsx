import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * NightWatch label (shadcn/ui new-york, Tailwind v4) on Radix Label.
 * Renders a real <label>, preserving implicit input association for
 * getByLabelText and assistive tech.
 */
function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-sm font-medium leading-none", className)}
      {...props}
    />
  );
}

export { Label };
