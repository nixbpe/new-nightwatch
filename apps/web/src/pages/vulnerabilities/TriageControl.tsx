import type { Triage, TriageInput } from "@nightwatch/api-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  putTriage,
  vulnerabilityErrorMessage,
  vulnerabilityKeys,
} from "../../lib/api/vulnerabilities";
import { usePreferences } from "../../lib/preferences";
import { formatUploadedAt } from "../inventory/format";

type Target = Pick<TriageInput, "mappingId" | "version" | "cveId">;

/**
 * The VEX status of one CVE of one component (S5.3): the status as last set with who set it,
 * when and why, and, for a Project admin, the two ways to set it. Not affected needs a reason,
 * so it asks for one first; affected is saved at once.
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

  return (
    <div className="space-y-1 text-[13px]" data-testid={`triage-${testId}`}>
      {triage === null ? (
        <span className="text-foreground-secondary">ยังไม่ triage</span>
      ) : (
        <span data-testid={`triage-status-${testId}`}>
          {triage.status === "affected" ? "ได้รับผลกระทบ" : "ไม่ได้รับผลกระทบ"}
          {triage.reason === null ? "" : `: ${triage.reason}`}
          <span className="block text-xs text-foreground-secondary">
            โดย {triage.changedBy ?? "ไม่ทราบผู้ทำรายการ"} เมื่อ{" "}
            <span className="font-mono">
              {formatUploadedAt(triage.changedAt, preferences)}
            </span>
          </span>
        </span>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            data-testid={`triage-affected-${testId}`}
            aria-pressed={triage?.status === "affected"}
            disabled={save.isPending}
            onClick={() => {
              setAsking(false);
              save.mutate({ ...target, status: "affected", reason: null });
            }}
          >
            ได้รับผลกระทบ
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid={`triage-not-affected-${testId}`}
            aria-pressed={triage?.status === "not_affected"}
            aria-expanded={asking}
            disabled={save.isPending}
            onClick={() => {
              setAsking((value) => !value);
              save.reset();
            }}
          >
            ไม่ได้รับผลกระทบ
          </Button>
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
          <label className="sr-only" htmlFor={`triage-reason-${testId}`}>
            เหตุผลที่ไม่ได้รับผลกระทบ
          </label>
          <Input
            id={`triage-reason-${testId}`}
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
      {save.isError ? (
        <Alert tone="error" data-testid={`triage-error-${testId}`}>
          {vulnerabilityErrorMessage(save.error)}
        </Alert>
      ) : null}
    </div>
  );
}
