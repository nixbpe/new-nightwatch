import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Own type so a wrapping <Label> cannot restyle the value.
        "h-10 w-full rounded-md border border-control-border bg-surface px-3 text-base font-normal text-foreground transition-colors " +
          "placeholder:text-foreground-secondary " +
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
          "disabled:cursor-not-allowed disabled:opacity-60 " +
          "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
