import type { Triage, TriageInput } from "@nightwatch/api-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { ChevronsUpDownIcon, CheckIcon } from "../../components/shell/icons";
import { usePopover } from "../../components/shell/usePopover";
import { InfoTip } from "../../components/ui/icon-button";
import { Input } from "../../components/ui/input";
import {
  putTriage,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { usePreferences } from "../../lib/preferences";
import { formatUploadedAt } from "../inventory/format";
import { MENU_WIDTH, placeMenu, triggerInView } from "./menuPlace";

type Target = Pick<TriageInput, "mappingId" | "version" | "cveId">;

/**
 * The VEX status of one CVE of one component (S5.3): the status as last set with its reason,
 * who set it and when in a tooltip, and, for a Project admin, one button that shows the status
 * and opens a menu of the two choices. Not affected needs a reason, so it opens a reason row;
 * affected is saved at once. The menu is drawn in a portal at fixed coordinates, because the
 * table and the folded group scroll inside their own containers and would clip it.
 */
export function TriageControl({
  organizationId,
  projectId,
  target,
  triage,
  canManage,
}: {
  organizationId: string;
  projectId: string;
  target: Target & { mappingId: string };
  triage: Triage | null;
  canManage: boolean;
}) {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const menu = usePopover();
  const reasonInput = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState({ left: 0, top: 0 });
  const save = useMutation({
    mutationFn: (input: TriageInput) =>
      putTriage(organizationId, projectId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: vulnerabilityKeys.all(organizationId, projectId),
      });
      setAsking(false);
      setReason("");
    },
  });
  const testId = `${target.cveId}-${target.mappingId}-${target.version}`;
  const statusText =
    triage === null
      ? "ยังไม่ triage"
      : triage.status === "affected"
        ? "ได้รับผลกระทบ"
        : "ไม่ได้รับผลกระทบ";
  // Read by assistive technology as the save runs and ends; the error is its own alert below.
  const announcement = save.isPending
    ? "กำลังบันทึกสถานะ VEX"
    : save.isSuccess
      ? "บันทึกสถานะ VEX แล้ว"
      : "";
  const placeAtTrigger = () => {
    const rect = menu.triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPlace(
      placeMenu(rect, { width: window.innerWidth, height: window.innerHeight }),
    );
  };
  const menuClose = menu.close;
  // The menu is fixed, so it follows its button when the page or a scrolling container moves,
  // and closes once the button is out of sight. Closing on every scroll would race with the
  // scroll a click causes (scrolling the button into view).
  const onMove = () => {
    const rect = menu.triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    if (triggerInView(rect, { height: window.innerHeight })) {
      placeAtTrigger();
    } else {
      menuClose();
    }
  };
  const moveHandler = useRef(onMove);
  moveHandler.current = onMove;
  useEffect(() => {
    if (!menu.open) return;
    const handler = () => {
      moveHandler.current();
    };
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [menu.open]);
  useEffect(() => {
    if (asking) reasonInput.current?.focus();
  }, [asking]);
  // Reset only before submission or after settlement; reset does not abort a request.
  const cancelAsking = () => {
    if (save.isPending) return;
    setAsking(false);
    setReason("");
    save.reset();
    menu.triggerRef.current?.focus();
  };
  const openMenu = () => {
    if (save.isPending) return;
    placeAtTrigger();
    menu.toggle();
  };
  // Tab leaves the menu to the trigger, so the next Tab continues in page order: the menu is
  // drawn outside it, at the end of the document.
  const leaveOnTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    menu.close();
  };
  const choices = [
    {
      status: "affected",
      label: "ได้รับผลกระทบ",
      checked: triage?.status === "affected",
      choose: () => {
        setAsking(false);
        save.mutate({ ...target, status: "affected", reason: null });
      },
    },
    {
      status: "not-affected",
      label: "ไม่ได้รับผลกระทบ",
      checked: triage?.status === "not_affected",
      choose: () => {
        setAsking(true);
        save.reset();
      },
    },
  ] as const;

  return (
    <div className="space-y-1.5 text-[13px]" data-testid={`triage-${testId}`}>
      <div className="flex flex-wrap items-center gap-1">
        {canManage ? (
          <button
            ref={menu.triggerRef}
            type="button"
            data-testid={`triage-menu-${testId}`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            aria-label={`สถานะ VEX ของ ${target.cveId}: ${statusText}`}
            aria-disabled={save.isPending ? true : undefined}
            onClick={openMenu}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-control-border bg-surface px-3 text-[13px] text-foreground hover:surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:opacity-60"
          >
            {save.isPending && !asking ? "กำลังบันทึก" : statusText}
            <ChevronsUpDownIcon size={14} />
          </button>
        ) : (
          <span
            data-testid={
              triage === null ? undefined : `triage-status-${testId}`
            }
            className={triage === null ? "text-foreground-secondary" : ""}
          >
            {statusText}
            {triage?.reason == null ? "" : `: ${triage.reason}`}
          </span>
        )}
        {triage === null ? null : (
          <InfoTip
            data-testid={`triage-by-${testId}`}
            label={`ตั้งโดย ${triage.changedBy ?? "ไม่ทราบผู้ทำรายการ"} เมื่อ ${formatUploadedAt(triage.changedAt, preferences)}`}
          />
        )}
      </div>
      {canManage && triage?.reason != null ? (
        <p
          className="text-foreground-secondary"
          data-testid={`triage-reason-text-${testId}`}
        >
          เหตุผล: {triage.reason}
        </p>
      ) : null}
      {canManage && menu.open
        ? createPortal(
            <div
              ref={menu.panelRef}
              role="menu"
              aria-label={`เปลี่ยนสถานะ VEX ของ ${target.cveId}`}
              data-testid={`triage-options-${testId}`}
              tabIndex={-1}
              onKeyDown={leaveOnTab}
              style={{
                position: "fixed",
                left: place.left,
                top: place.top,
                width: MENU_WIDTH,
              }}
              className="overlay-enter z-50 rounded-md border border-foreground/10 bg-surface p-1 shadow-lg focus:outline-none"
            >
              {choices.map((choice) => (
                <button
                  key={choice.status}
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={choice.checked}
                  data-testid={`triage-${choice.status}-${testId}`}
                  onClick={() => {
                    if (save.isPending) return;
                    menu.close();
                    choice.choose();
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-start text-sm text-foreground hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="inline-flex w-4 justify-center">
                    {choice.checked ? <CheckIcon size={14} /> : null}
                  </span>
                  {choice.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {canManage && asking ? (
        <form
          className="flex w-full max-w-64 flex-col items-start gap-2"
          aria-busy={save.isPending}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancelAsking();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending) return;
            save.mutate({
              ...target,
              status: "not_affected",
              reason: reason.trim(),
            });
          }}
        >
          <label
            className="text-xs text-foreground-secondary"
            htmlFor={reasonId}
          >
            เหตุผลที่ไม่ได้รับผลกระทบ (จำเป็น)
          </label>
          <Input
            ref={reasonInput}
            id={reasonId}
            data-testid={`triage-reason-${testId}`}
            className="w-full text-sm"
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              data-testid={`triage-save-${testId}`}
              disabled={save.isPending || reason.trim() === ""}
            >
              {save.isPending ? "กำลังบันทึก" : "บันทึก"}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid={`triage-cancel-${testId}`}
              disabled={save.isPending}
              onClick={cancelAsking}
            >
              ยกเลิก
            </Button>
          </div>
        </form>
      ) : null}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {save.isError ? (
        <Alert tone="error" data-testid={`triage-error-${testId}`}>
          {vulnerabilityErrorMessage(save.error)}
        </Alert>
      ) : null}
    </div>
  );
}
