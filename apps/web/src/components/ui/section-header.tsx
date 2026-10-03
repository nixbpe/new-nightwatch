import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

// TYP-04: the section code is `aria-hidden` so the heading's name stays its title.
// Callers wrap values in `font-mono`; meta text stays sans-serif.
export function SectionHeader({
  id,
  title,
  code,
  meta,
  note,
  headingRef,
  headingTabIndex,
  headingClassName,
  className,
}: {
  /** For `aria-labelledby` on the section this header opens. */
  id?: string;
  title: ReactNode;
  code?: string;
  meta?: ReactNode;
  /** A line under the heading, in the left column. */
  note?: ReactNode;
  /** For a heading that takes programmatic focus. */
  headingRef?: Ref<HTMLHeadingElement>;
  headingTabIndex?: number;
  headingClassName?: string;
  className?: string;
}) {
  const heading = (
    <h2
      id={id}
      ref={headingRef}
      tabIndex={headingTabIndex}
      className={cn(
        "flex min-w-0 items-baseline gap-3 text-base font-semibold text-heading",
        headingClassName,
      )}
    >
      {code === undefined ? null : (
        <span
          aria-hidden="true"
          className="font-mono text-xs font-medium tracking-[0.08em] text-foreground-secondary"
        >
          {code}
        </span>
      )}
      <span className="min-w-0">{title}</span>
    </h2>
  );
  return (
    <div
      data-slot="section-header"
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-foreground/10 pb-3",
        className,
      )}
    >
      {note === undefined ? (
        heading
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          {heading}
          <p className="text-[13px] text-foreground-secondary">{note}</p>
        </div>
      )}
      {meta === undefined ? null : (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-foreground-secondary">
          {meta}
        </div>
      )}
    </div>
  );
}
