export type SelfLeaveAttempt =
  "responded" | "last-owner" | "last-project-admin" | "other-failure";
export type SelfLeaveOrigin = Readonly<{
  signal: AbortSignal;
  isCurrent: () => boolean;
}>;
export type SelfLeaveInput = Readonly<{
  organizationId: string;
  origin: SelfLeaveOrigin;
  attempt: SelfLeaveAttempt;
  /** Server text for `last-project-admin`, which names the Projects. */
  message?: string;
}>;
export type SelfLeaveView =
  | { kind: "idle" }
  | { kind: "confirming" | "refresh-failed" | "ready"; organizationId: string }
  | {
      kind: "not-left";
      organizationId: string;
      notice: "last-owner" | "last-project-admin" | "other";
      message?: string;
    };
