import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * NightWatch input (shadcn/ui new-york, Tailwind v4).
 * Surface fill, control-boundary outline, 4px radius, 40px tall (the same
 * height as the default <Button>); invalid fields take the danger boundary.
 */
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Own type so a wrapping <Label> (14px medium) cannot restyle the value.
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
