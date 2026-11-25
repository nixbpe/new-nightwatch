import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Heights follow LAY-06: 40 px for forms, 32 px for row actions and filter bars.
const SIZES = {
  sm: "h-8 px-2 text-sm",
  md: "h-10 px-3 text-base",
} as const;

type SelectProps = Omit<ComponentProps<"select">, "size"> & {
  size?: keyof typeof SIZES;
};

/** Native `<select>` with the `Input` field styling. The caller supplies the label. */
function Select({ className, size = "md", ...props }: SelectProps) {
  return (
    <select
      data-slot="select"
      className={cn(
        "field-caret w-full appearance-none rounded-md border border-control-border bg-surface font-normal text-foreground transition-colors " +
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
          "disabled:cursor-not-allowed disabled:opacity-60 " +
          "aria-invalid:border-danger",
        SIZES[size],
        "pr-8",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
