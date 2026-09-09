import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * NightWatch input (shadcn/ui new-york, Tailwind v4).
 * Surface fill, control-boundary outline, 6px radius; invalid fields take
 * the danger boundary. Matches the previous textInputClass visuals.
 */
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full rounded-md border border-control-border bg-surface px-3 py-2 text-foreground transition-colors " +
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
