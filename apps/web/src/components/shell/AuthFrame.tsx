import type { ReactNode } from "react";

import { Card } from "../ui/card";
import { ShieldIcon } from "./icons";

// Bare-layout chrome shared by /login and the other pre-session routes: the 56 px
// header with the wordmark, Canvas below it.
export function AuthHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-foreground/10 px-4 sm:px-8">
      <span className="inline-flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center rounded-[4px] bg-primary text-on-primary"
        >
          <ShieldIcon size={14} />
        </span>
        <span className="font-mono text-[13px] font-semibold tracking-[0.14em] text-heading uppercase">
          NightWatch
        </span>
      </span>
      {children}
    </header>
  );
}

// Mono Primary route code (TYP-04). Latin only; the heading keeps its own name.
export function AuthEyebrow({ children }: { children: string }) {
  return (
    <p className="font-mono text-xs tracking-[0.12em] text-primary uppercase">
      {children}
    </p>
  );
}

// Drop-in for the old AuthPageShell: same title/subtitle/children, restyled.
export function AuthPageFrame({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AuthHeader />
      <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <Card className="w-full max-w-md p-6 sm:p-8">
          <AuthEyebrow>{eyebrow}</AuthEyebrow>
          <h1 className="mt-2 text-[28px] leading-9 font-semibold text-heading">
            {title}
          </h1>
          {subtitle === undefined ? null : (
            <p className="mt-2 text-sm text-foreground-secondary">{subtitle}</p>
          )}
          <div className="mt-6">{children}</div>
        </Card>
      </main>
    </div>
  );
}
