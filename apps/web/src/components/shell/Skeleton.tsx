/**
 * Shell-level loading placeholder (Step 7 hardening) — a plain pulsing
 * block using existing tokens only (bg-background, same as every muted
 * fill elsewhere). Used by the header while the session is still
 * resolving (see Header.tsx); available for page content to reuse for
 * its own loading states, distinct from FullPageLoading's full-viewport
 * spinner (components/ui.tsx) which suits a page that has nothing else
 * to show yet.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-pulse rounded-md bg-background ${className}`}
    />
  );
}
