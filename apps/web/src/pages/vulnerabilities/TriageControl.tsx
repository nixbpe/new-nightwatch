import type { Triage, TriageInput } from "@nightwatch/api-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { InfoTip } from "../../components/ui/icon-button";
import { Input } from "../../components/ui/input";
import {
  putTriage,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { cn } from "@/lib/utils";
import { usePreferences } from "../../lib/preferences";
import { formatUploadedAt } from "../inventory/format";

type Target = Pick<TriageInput, "mappingId" | "version" | "cveId">;

/**
 * The VEX status of one CVE of one component (S5.3): the status as last set with its reason,
 * who set it and when in a tooltip, and, for a Project admin, a two-segment control to set it.
 * Not affected needs a reason, so it opens a reason row first; affected is saved at once.
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
  const save = useMutation({
    mutationFn: (input: TriageInput) =>
      putTriage(organizationId, projectId, input),
    onSuccess: async () => {
      setAsking(false);
      setReason("");
      await queryClient.invalidateQueries({
        queryKey: vulnerabilityKeys.all(organizationId, projectId),
      });
    },
  });
  const testId = `${target.cveId}-${target.mappingId}-${target.version}`;
  const groupLabel = `สถานะ VEX ของ ${target.cveId}`;
  // Read by assistive technology as the save runs and ends; the error is its own alert below.
  const announcement = save.isPending
    ? "กำลังบันทึกสถานะ VEX"
    : save.isSuccess
      ? "บันทึกสถานะ VEX แล้ว"
      : "";

  return (
    <div className="space-y-1.5 text-[13px]" data-testid={`triage-${testId}`}>
      <div className="flex flex-wrap items-center gap-1">
        {triage === null ? (
          <span className="text-foreground-secondary">ยังไม่ triage</span>
        ) : (
          <>
            <span data-testid={`triage-status-${testId}`}>
              {triage.status === "affected"
                ? "ได้รับผลกระทบ"
                : "ไม่ได้รับผลกระทบ"}
              {triage.reason === null ? "" : `: ${triage.reason}`}
            </span>
            <InfoTip
              data-testid={`triage-by-${testId}`}
              label={`ตั้งโดย ${triage.changedBy ?? "ไม่ทราบผู้ทำรายการ"} เมื่อ ${formatUploadedAt(triage.changedAt, preferences)}`}
            />
          </>
        )}
      </div>
      {canManage ? (
        <div
          role="group"
          aria-label={groupLabel}
          className="inline-flex gap-0.5 rounded-md border border-control-border p-0.5"
        >
          {(
            [
              {
                status: "affected",
                label: "ได้รับผลกระทบ",
                pressed: triage?.status === "affected",
                onClick: () => {
                  setAsking(false);
                  save.mutate({ ...target, status: "affected", reason: null });
                },
              },
              {
                status: "not-affected",
                label: "ไม่ได้รับผลกระทบ",
                pressed: triage?.status === "not_affected",
                onClick: () => {
                  setAsking((value) => !value);
                  save.reset();
                },
              },
            ] as const
          ).map((option) => (
            <button
              key={option.status}
              type="button"
              data-testid={`triage-${option.status}-${testId}`}
              aria-pressed={option.pressed}
              aria-expanded={
                option.status === "not-affected" ? asking : undefined
              }
              disabled={save.isPending}
              onClick={option.onClick}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-3 text-[13px] transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60",
                option.pressed
                  ? "surface-active font-medium text-foreground"
                  : "text-foreground-secondary hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {canManage && asking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              ...target,
              status: "not_affected",
              reason: reason.trim(),
            });
          }}
        >
          <label className="sr-only" htmlFor={reasonId}>
            เหตุผลที่ไม่ได้รับผลกระทบ
          </label>
          <Input
            id={reasonId}
            data-testid={`triage-reason-${testId}`}
            className="h-8 w-64 text-sm"
            maxLength={500}
            placeholder="เหตุผล (จำเป็น)"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <Button
            type="submit"
            data-testid={`triage-save-${testId}`}
            disabled={save.isPending || reason.trim() === ""}
          >
            บันทึก
          </Button>
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
