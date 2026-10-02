import { auditScopeNote } from "@nightwatch/api-contract";

// P-05, AC-09: the text comes from the contract so the page, the dialog and the files agree.
export function RecordingScopeNote({ since }: { since?: string }) {
  return (
    <p className="rounded-md border border-foreground/15 bg-foreground/4 px-3 py-2 text-sm text-foreground">
      {auditScopeNote(since ?? "…")}
    </p>
  );
}
