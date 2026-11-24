import type { ReactNode } from "react";
import { Link } from "react-router";

import { ArrowLeftIcon } from "../../components/shell/icons";

// The one back link of the monitor pages: "รายการมอนิเตอร์" is the list, "มอนิเตอร์" is the monitor's own page.
export function BackLink({
  to,
  testId,
  children,
}: {
  to: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Link
      data-testid={testId}
      to={to}
      className="inline-flex min-h-6 items-center gap-1.5 self-start text-xs text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <ArrowLeftIcon size={14} />
      {children}
    </Link>
  );
}
