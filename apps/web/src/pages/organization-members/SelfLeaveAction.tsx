import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import {
  UNSAFE_DataRouterContext,
  useLocation,
  useNavigation,
  useRevalidator,
} from "react-router";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ApiError } from "../../lib/api/client";
import { leaveOrganization } from "../../lib/api/members";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { useOrganizationScope } from "./useOrganizationScope";

import { PageState } from "../../components/shell/PageState";
import { useTenant } from "../../lib/tenant/TenantProvider";
import type { SelfLeaveOrigin } from "../../lib/tenant/selfLeave";

const SelfLeaveOriginContext = createContext<SelfLeaveOrigin | null>(null);

export function SelfLeaveRouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const routerContext = useContext(UNSAFE_DataRouterContext);
  if (routerContext === null)
    throw new Error("Self leave requires a data router");
  const router = routerContext.router;
  const anchor = useRef<HTMLDivElement>(null);
  const { selfLeave, retrySelfLeave, deliverSelfLeave } = useTenant();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const makeOrigin = (key: string) => {
    const controller = new AbortController();
    const isCurrent = () =>
      !controller.signal.aborted &&
      anchor.current?.isConnected === true &&
      router.state.location.key === key &&
      router.state.navigation.state === "idle" &&
      router.state.revalidation === "idle";
    return { key, signal: controller.signal, isCurrent, controller };
  };
  const [origin, setOrigin] = useState(() => makeOrigin(location.key));
  if (
    origin.key !== location.key ||
    (origin.signal.aborted &&
      navigation.state === "idle" &&
      revalidator.state === "idle")
  )
    setOrigin(makeOrigin(location.key));
  useEffect(() => {
    const stop = router.subscribe(() => {
      if (!origin.isCurrent()) origin.controller.abort();
    });
    return () => {
      stop();
      // StrictMode replays effects while this same origin node remains connected.
      if (!origin.isCurrent()) origin.controller.abort();
    };
  }, [origin, router]);
  useLayoutEffect(() => {
    deliverSelfLeave(origin, (organizationId) => {
      void router.navigate(
        organizationId === null
          ? "/workspace"
          : `/organizations/${organizationId}/members`,
        { replace: true, state: SELF_LEFT_STATE },
      );
    });
  }, [origin, selfLeave, deliverSelfLeave, router]);
  return (
    <SelfLeaveOriginContext.Provider value={origin}>
      <div ref={anchor} className="contents">
        {selfLeave.kind === "confirming" ? (
          <PageState
            kind="loading"
            label="กำลังยืนยันการออกจากองค์กร"
            visibleLabel
          />
        ) : selfLeave.kind === "refresh-failed" ? (
          <PageState
            kind="error"
            message="ไม่สามารถยืนยันสถานะการเป็นสมาชิกได้"
            retryLabel="ลองอีกครั้ง"
            onRetry={() => void retrySelfLeave(origin)}
          />
        ) : (
          children
        )}
      </div>
    </SelfLeaveOriginContext.Provider>
  );
}

const LEAVE_ATTRIBUTE = "data-self-leave";

const SELF_LEFT_STATE = { selfLeft: true } as const;

/**
 * After a confirmed leave the old page and its dialog are gone, so the
 * destination heading takes focus once it exists (Organization page or
 * no-access). Runs once per arrival.
 */
export function useFocusHeadingAfterSelfLeave(
  headingRef: RefObject<HTMLElement | null>,
) {
  const state = useLocation().state as { selfLeft?: boolean } | null;
  const pending = useRef(state?.selfLeft === true);
  useEffect(() => {
    if (!pending.current) return;
    const heading = headingRef.current;
    if (heading === null) return;
    pending.current = false;
    heading.focus();
  });
}

type Phase = "idle" | "leaving";

/**
 * Self-leave flow for one Organization's member page. It works for every role
 * because it needs neither the member list nor a member row. Success is
 * decided by the server-confirmed context, never by the DELETE response.
 * Cancel and Escape send no request, and a failed DELETE is never replayed.
 */
export function useSelfLeave({
  organizationId,
  blocked,
  headingRef,
}: {
  organizationId: string;
  /** Focus lands here when the dialog's opener unmounts with the page body. */
  headingRef: RefObject<HTMLElement | null>;
  /** Another member mutation is in flight. */
  blocked: boolean;
}) {
  const origin = useContext(SelfLeaveOriginContext);
  const { selfLeave, settleSelfLeave, consumeSelfLeaveNotice } = useTenant();
  const { isCurrentScope, scopeCurrent } = useOrganizationScope(organizationId);
  const [phase, setPhase] = useState<Phase>("idle");
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    opener: HTMLElement;
  } | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (
      selfLeave.kind !== "not-left" ||
      selfLeave.organizationId !== organizationId
    )
      return;
    setNotice(
      selfLeave.notice === "last-owner"
        ? "องค์กรต้องมีเจ้าของอย่างน้อยหนึ่งคน คุณยังไม่ได้ออกจากองค์กร และโหลดสถานะล่าสุดแล้ว"
        : "ออกจากองค์กรไม่สำเร็จ โหลดสถานะล่าสุดแล้ว",
    );
    restoreFocus.current = true;
    inFlight.current = false;
    setPhase("idle");
    consumeSelfLeaveNotice(organizationId);
  }, [selfLeave, organizationId, consumeSelfLeaveNotice]);

  useEffect(() => {
    if (!restoreFocus.current || phase !== "idle") return;
    restoreFocus.current = false;
    const active = document.activeElement;
    if (active !== document.body && active !== headingRef.current) return;
    document.querySelector<HTMLElement>(`[${LEAVE_ATTRIBUTE}]`)?.focus();
  });

  async function submit() {
    if (inFlight.current || blocked || !isCurrentScope()) return;
    if (origin === null)
      throw new Error("Self leave requires its stable route boundary");
    inFlight.current = true;
    setPhase("leaving");
    setNotice(null);
    let failure: unknown = null;
    try {
      const response = await leaveOrganization(organizationId);
      if (response.member.organizationId !== organizationId) {
        throw new Error("Leave response does not match the requested scope");
      }
    } catch (error) {
      failure = error;
    }
    if (!isCurrentScope()) return;
    setConfirmation(null);
    // The outcome of a failed DELETE is unknown (it may have committed), so the
    // server-confirmed context decides in both cases.
    await settleSelfLeave({
      organizationId,
      origin,
      attempt:
        failure === null
          ? "responded"
          : failure instanceof ApiError && failure.code === "LAST_OWNER"
            ? "last-owner"
            : "other-failure",
    });
  }

  const live = scopeCurrent;
  return {
    phase: live ? phase : "idle",
    pending: live && phase !== "idle",
    notice: live ? notice : null,
    confirmation: live ? confirmation : null,
    request: (opener: HTMLElement) => {
      if (inFlight.current || blocked || !isCurrentScope()) return;
      setNotice(null);
      setConfirmation({ opener });
    },
    confirm: () => {
      if (confirmation !== null) void submit();
    },
    cancel: () => {
      if (inFlight.current) return;
      setConfirmation(null);
    },
  };
}

export type SelfLeave = ReturnType<typeof useSelfLeave>;

/** Page-header action that opens the leave confirmation; shown to every role. */
export function SelfLeaveButton({
  selfLeave,
  disabled,
}: {
  selfLeave: SelfLeave;
  disabled: boolean;
}) {
  return (
    <Button
      {...{ [LEAVE_ATTRIBUTE]: "" }}
      type="button"
      variant="secondary"
      wrap
      disabled={disabled || selfLeave.pending}
      onClick={(event) => {
        selfLeave.request(event.currentTarget);
      }}
    >
      ออกจากองค์กร
    </Button>
  );
}

/** Result notice and confirmation dialog; the entry button sits in the page header. */
export function SelfLeaveSection({
  selfLeave,
  organization,
  actor,
  headingRef,
}: {
  selfLeave: SelfLeave;
  organization: { name: string; slug: string; role: string };
  actor: { name: string; email: string } | undefined;
  headingRef: RefObject<HTMLElement | null>;
}) {
  return (
    <>
      {selfLeave.notice !== null ? (
        <Alert tone="error">{selfLeave.notice}</Alert>
      ) : null}
      {selfLeave.confirmation !== null ? (
        <ConfirmDialog
          title="ยืนยันการออกจากองค์กร"
          description={
            <>
              <p>
                {actor === undefined ? "คุณ" : `${actor.name} (${actor.email})`}{" "}
                กำลังออกจากองค์กร {organization.name} ({organization.slug})
              </p>
              <p className="mt-2">
                คุณจะเข้าถึงองค์กรนี้ไม่ได้ทันที
                แต่บัญชีและสมาชิกภาพในองค์กรอื่นยังอยู่
                {organization.role === "owner"
                  ? " เจ้าของคนสุดท้ายออกไม่ได้ ต้องมีเจ้าของอีกคนก่อน"
                  : ""}
              </p>
            </>
          }
          confirmLabel="ยืนยันการออกจากองค์กร"
          confirmVariant="destructive"
          pendingLabel="กำลังออกจากองค์กร…"
          pending={selfLeave.pending}
          opener={selfLeave.confirmation.opener}
          fallbackFocus={headingRef}
          onCancel={selfLeave.cancel}
          onConfirm={selfLeave.confirm}
        />
      ) : null}
    </>
  );
}
