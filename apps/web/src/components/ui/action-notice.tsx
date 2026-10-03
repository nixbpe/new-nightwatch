import { useEffect, useState, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

// A page-level notice with actions. `Notice` is a bare `<p role="status">` used by other
// pages, so this is its own component. Only the message sits in the live region; links that
// are part of the sentence may be inside it (m-1), separate actions and the close button stay
// outside so a screen reader announces the message alone. The region mounts empty and gets
// its text one commit later, because a region that arrives with its text is often not
// announced. Neutral (pending) tone only: an export request is not a success yet.
function ActionNotice({
  children,
  actions,
  onClose,
  focusable = false,
  live = true,
  ref,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  /** Renders the close button, named "ปิดข้อความ". */
  onClose?: () => void;
  /** Lets code move focus here (`tabindex="-1"` on the container). */
  focusable?: boolean;
  /** `false` when the page announces the message through its own live region. */
  live?: boolean;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    setAnnounced(true);
  }, []);
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
        role={live ? "status" : undefined}
        className="inline-flex items-center gap-1.5 text-foreground-secondary"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
        />
        {announced || !live ? <span>{children}</span> : null}
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
