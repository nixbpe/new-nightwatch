import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-[18px] shrink-0 accent-primary disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
