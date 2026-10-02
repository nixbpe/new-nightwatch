import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

// A page-level notice with actions. `Notice` is a bare `<p role="status">` used by other
// pages, so this is its own component: only the text sits in the live region; the links and
// the close button stay outside it so a screen reader announces the message alone. Neutral
// (pending) tone only: an export request is not a success yet.
function ActionNotice({
  children,
  actions,
  onClose,
  focusable = false,
  ref,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  /** Renders the close button, named "ปิดข้อความ". */
  onClose?: () => void;
  /** Lets code move focus here (`tabindex="-1"` on the container). */
  focusable?: boolean;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div
      ref={ref}
      tabIndex={focusable ? -1 : undefined}
      data-slot="action-notice"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-foreground/15 bg-foreground/4 px-3 py-2 text-sm text-foreground focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      <p
        role="status"
        className="inline-flex items-center gap-1.5 text-foreground-secondary"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
        />
        <span>{children}</span>
      </p>
      {actions}
      {onClose === undefined ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="ปิดข้อความ"
          onClick={onClose}
        >
          ปิด
        </Button>
      )}
    </div>
  );
}

export { ActionNotice };
