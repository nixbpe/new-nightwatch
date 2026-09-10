import type { ReactNode } from "react";

/** Keyboard-shortcut hint (⌘K, esc, ↵) — monospace per the type rules. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5 px-1 font-mono text-[11px] text-foreground-secondary">
      {children}
    </kbd>
  );
}
