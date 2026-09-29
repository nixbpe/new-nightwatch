import type { ReactNode } from "react";

import { Alert } from "../ui";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Skeleton } from "./Skeleton";

type LoadingState = {
  kind: "loading";
  /** Announced to assistive technology; shown only when `visibleLabel` is set. */
  label: string;
  layout?: "lines" | "rows" | "table";
  rows?: number;
  visibleLabel?: boolean;
};

type ErrorState = {
  kind: "error";
  message: ReactNode;
  retryLabel?: string;
  onRetry?: () => void;
  actions?: ReactNode;
};

type DeniedState = {
  kind: "denied";
  message: ReactNode;
  tone?: "error" | "info";
  action?: ReactNode;
};

// Page-level loading, error and denied views render inside the frame under
// the page header, never as their own main region (docs/ref/shell-structure.md).
export function PageState(props: LoadingState | ErrorState | DeniedState) {
  if (props.kind === "loading") {
    const layout = props.layout ?? "lines";
    const label = (
      <p
        role="status"
        aria-label={props.label}
        className={
          props.visibleLabel === true
            ? "text-sm text-foreground-secondary"
            : "sr-only"
        }
      >
        {props.label}
      </p>
    );
    if (layout === "lines") {
      return (
        <Card padding="md" aria-busy="true">
          {label}
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </Card>
      );
    }
    const count = props.rows ?? (layout === "rows" ? 3 : 5);
    const keys = Array.from({ length: count }, (_, index) => index);
    if (layout === "rows") {
      return (
        <Card aria-busy="true">
          {label}
          {keys.map((row) => (
            <div
              key={row}
              className="flex gap-3 border-b border-foreground/10 px-4 py-3 last:border-b-0"
            >
              <Skeleton className="ml-5 h-8 w-8 shrink-0" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-32" />
              </span>
            </div>
          ))}
        </Card>
      );
    }
    return (
      <Card aria-busy="true">
        {props.visibleLabel === true ? (
          <div className="px-4 pt-4">{label}</div>
        ) : (
          label
        )}
        <div className="surface-inset flex h-11 items-center gap-8 border-b border-foreground/10 px-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-12" />
        </div>
        {keys.map((row) => (
          <div
            key={row}
            className="flex h-11 items-center gap-8 border-b border-foreground/10 px-4 last:border-b-0"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    );
  }
  if (props.kind === "error") {
    return (
      <Card as="section" padding="md">
        <Alert tone="error">{props.message}</Alert>
        {props.onRetry === undefined && props.actions === undefined ? null : (
          <div className="flex flex-wrap gap-2">
            {props.onRetry === undefined ? null : (
              <Button type="button" variant="secondary" onClick={props.onRetry}>
                {props.retryLabel ?? "ลองใหม่"}
              </Button>
            )}
            {props.actions}
          </div>
        )}
      </Card>
    );
  }
  return (
    <Card as="section" padding="md">
      <Alert tone={props.tone ?? "error"}>{props.message}</Alert>
      {props.action === undefined ? null : <div>{props.action}</div>}
    </Card>
  );
}
