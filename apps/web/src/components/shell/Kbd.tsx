import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5 px-1 font-mono text-xs text-foreground-secondary">
      {children}
    </kbd>
  );
}
