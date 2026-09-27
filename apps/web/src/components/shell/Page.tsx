import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

export function Page({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full max-w-[960px] flex-col gap-6", className)}>
      {children}
    </div>
  );
}

// No letter tracking on the title: it is Thai text.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleRef,
  titleTabIndex,
  titleClassName,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTabIndex?: number;
  titleClassName?: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="min-w-0">
        {eyebrow === undefined ? null : (
          <p className="text-xs text-foreground-secondary">{eyebrow}</p>
        )}
        <h1
          className={cn(
            "mt-2 text-[28px] leading-9 font-semibold",
            titleClassName,
          )}
          ref={titleRef}
          tabIndex={titleTabIndex}
        >
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="mt-2 text-sm text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
