import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Offset focus outline stays visible against the solid primary fill; 40px height matches <Input>.
// Filled variants go neutral when disabled instead of fading, so a disabled
// primary never reads as a washed-out action; `wrap` lets long Thai labels
// break onto two lines at narrow widths without an ancestor override.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
    "disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-on-primary hover:bg-primary/90 disabled:bg-foreground/8 disabled:text-foreground-secondary disabled:hover:bg-foreground/8",
        secondary:
          "border border-control-border bg-surface text-foreground hover:bg-background disabled:opacity-60",
        destructive:
          "bg-danger text-white hover:bg-danger/90 disabled:bg-foreground/8 disabled:text-foreground-secondary disabled:hover:bg-foreground/8",
        outline:
          "border border-control-border bg-surface text-foreground hover:bg-background disabled:opacity-60",
        ghost:
          "text-foreground-secondary hover:bg-background hover:text-foreground disabled:opacity-60",
        link: "text-primary underline-offset-4 hover:underline disabled:opacity-60",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        quiet: "h-8 px-3 text-[13px]",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
      },
      wrap: {
        true: "h-auto min-w-0 whitespace-normal py-2",
      },
    },
    compoundVariants: [
      { wrap: true, size: "default", class: "min-h-10" },
      { wrap: true, size: "sm", class: "min-h-8" },
      { wrap: true, size: "quiet", class: "min-h-8" },
      { wrap: true, size: "lg", class: "min-h-11" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  wrap,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, wrap, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
