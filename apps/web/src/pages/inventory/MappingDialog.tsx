import {
  cpeNameSchema,
  purlSchema,
  type CpeCandidate,
  type InventoryMapping,
} from "@nightwatch/api-contract";
import { useMutation } from "@tanstack/react-query";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Alert, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  trapDialogTab,
  useDialogFocusReturn,
} from "../../components/ui/useDialogFocusReturn";
import {
  decideMapping,
  inventoryErrorMessage,
  searchCpe,
} from "../../lib/api/inventory";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(",");

type Scope = { organizationId: string; projectId: string };

/** Edits the CPE or purl of one mapping: search the NVD dictionary or type either one. */
export function MappingDialog({
  mapping,
  scope,
  opener,
  fallbackFocus,
  onCancel,
  onSaved,
}: {
  mapping: InventoryMapping;
  scope: Scope;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSaved: (saved: InventoryMapping) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(`${mapping.vendor} ${mapping.product}`);
  const [candidates, setCandidates] = useState<CpeCandidate[] | null>(null);
  const [picked, setPicked] = useState<string | null>(mapping.cpe);
  const [typedCpe, setTypedCpe] = useState("");
  const [typedPurl, setTypedPurl] = useState(mapping.purl ?? "");
  const [errors, setErrors] = useState<{ cpe?: string; purl?: string }>({});

  useDialogFocusReturn(dialog, searchInput, opener, fallbackFocus);

  const search = useMutation({
    mutationFn: () =>
      searchCpe(
        scope.organizationId,
        scope.projectId,
        mapping.id,
        query.trim(),
      ),
    onSuccess: (result) => {
      setCandidates(result.candidates);
      setPicked(result.candidates[0]?.cpe ?? null);
    },
  });
  const save = useMutation({
    mutationFn: (body: { cpe?: string; purl?: string }) =>
      decideMapping(scope.organizationId, scope.projectId, mapping.id, {
        action: "confirm",
        ...body,
      }),
    onSuccess: onSaved,
  });
  const busy = search.isPending || save.isPending;

  const submit = () => {
    const purl = typedPurl.trim();
    const cpe = typedCpe.trim();
    const next: { cpe?: string; purl?: string } = {};
    if (purl !== "" && !purlSchema.safeParse(purl).success) {
      next.purl = "รูปแบบ purl ไม่ถูกต้อง เช่น pkg:deb/ubuntu/openssl@3.0.2";
    }
    if (cpe !== "" && !cpeNameSchema.safeParse(cpe).success) {
      next.cpe =
        "รูปแบบ CPE 2.3 ไม่ถูกต้อง เช่น cpe:2.3:a:f5:big-ip:17.1.1:*:*:*:*:*:*:*";
    }
    setErrors(next);
    if (next.cpe !== undefined || next.purl !== undefined) return;
    // A typed value wins over a search result: the reviewer meant it.
    const chosen =
      purl !== ""
        ? { purl }
        : cpe !== ""
          ? { cpe }
          : picked !== null
            ? { cpe: picked }
            : null;
    if (chosen === null) {
      setErrors({ cpe: "เลือกผลการค้น หรือกรอก CPE หรือ purl" });
      return;
    }
    save.mutate(chosen);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    trapDialogTab(event, dialog.current, FOCUSABLE);
  };

  return createPortal(
    <div className="backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        ref={dialog}
        data-testid="mapping-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy ? true : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="overlay-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-[640px] flex-col rounded-md border border-foreground/10 bg-surface text-foreground shadow-modal focus:outline-none"
      >
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <h2 id={titleId} className="text-lg font-semibold text-heading">
            แก้ CPE/purl
          </h2>
          <p
            id={descriptionId}
            className="mt-1 text-[13px] break-words text-foreground-secondary"
          >
            {mapping.vendor} · {mapping.product}
            {mapping.systems.length === 0
              ? ""
              : ` · ${mapping.systems.join(", ")}`}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm sm:px-6">
          {search.isError ? (
            <Alert tone="error" data-testid="mapping-search-error">
              {inventoryErrorMessage(search.error)}
            </Alert>
          ) : null}
          {save.isError ? (
            <Alert tone="error" data-testid="mapping-save-error">
              {inventoryErrorMessage(save.error)}
            </Alert>
          ) : null}
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim().length >= 2 && !busy) search.mutate();
            }}
          >
            <Label htmlFor="mapping-query" className="font-medium">
              ค้นใน NVD CPE dictionary
            </Label>
            <div className="flex gap-2">
              <Input
                id="mapping-query"
                data-testid="mapping-query"
                type="search"
                ref={searchInput}
                value={query}
                maxLength={100}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
              <Button
                type="submit"
                variant="outline"
                data-testid="mapping-search"
                disabled={busy || query.trim().length < 2}
              >
                {search.isPending ? "กำลังค้น…" : "ค้น"}
              </Button>
            </div>
          </form>
          {candidates === null ? null : (
            <fieldset
              className="flex flex-col gap-2"
              data-testid="mapping-candidates"
            >
              <legend className="pb-2 font-medium">
                ผลการค้น{" "}
                <span className="font-mono text-foreground-secondary">
                  {candidates.length}
                </span>
              </legend>
              {candidates.length === 0 ? (
                <p className="text-foreground-secondary">
                  ไม่พบใน dictionary กรอก CPE หรือ purl เอง หรือเลือกว่าไม่มี
                </p>
              ) : (
                candidates.map((candidate) => (
                  <label
                    key={candidate.cpe}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${picked === candidate.cpe ? "border-primary" : "border-control-border"}`}
                  >
                    <input
                      type="radio"
                      name="cpe"
                      data-testid="mapping-candidate"
                      checked={picked === candidate.cpe}
                      onChange={() => {
                        setPicked(candidate.cpe);
                      }}
                      className="h-[18px] w-[18px] accent-primary"
                    />
                    <span className="min-w-0 flex-1 font-mono text-[13px] break-all">
                      {candidate.cpe}
                    </span>
                    <span className="font-mono text-xs text-foreground-secondary">
                      {Math.round(candidate.confidence * 100)}%
                    </span>
                  </label>
                ))
              )}
            </fieldset>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="mapping-cpe" className="font-medium">
              หรือกรอก CPE 2.3 เอง
            </Label>
            <Input
              id="mapping-cpe"
              data-testid="mapping-cpe"
              value={typedCpe}
              maxLength={512}
              aria-invalid={errors.cpe === undefined ? undefined : true}
              aria-describedby={
                errors.cpe === undefined ? undefined : "mapping-cpe-error"
              }
              className="font-mono text-[14px]"
              placeholder="cpe:2.3:a:f5:big-ip:17.1.1:*:*:*:*:*:*:*"
              onChange={(event) => {
                setTypedCpe(event.target.value);
              }}
            />
            {errors.cpe === undefined ? null : (
              <span
                id="mapping-cpe-error"
                role="alert"
                data-testid="mapping-cpe-error"
                className="text-sm text-danger"
              >
                {errors.cpe}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="mapping-purl" className="font-medium">
              หรือกรอก purl เอง{" "}
              <span className="font-normal text-foreground-secondary">
                (package ของ distro)
              </span>
            </Label>
            <Input
              id="mapping-purl"
              data-testid="mapping-purl"
              value={typedPurl}
              maxLength={512}
              aria-invalid={errors.purl === undefined ? undefined : true}
              aria-describedby={
                errors.purl === undefined ? undefined : "mapping-purl-error"
              }
              className="font-mono text-[14px]"
              placeholder="pkg:deb/ubuntu/openssl@3.0.2-0ubuntu1.10?distro=ubuntu-22.04"
              onChange={(event) => {
                setTypedPurl(event.target.value);
              }}
            />
            {errors.purl === undefined ? null : (
              <span
                id="mapping-purl-error"
                role="alert"
                data-testid="mapping-purl-error"
                className="text-sm text-danger"
              >
                {errors.purl}
              </span>
            )}
            <span className="text-[13px] text-foreground-secondary">
              ระบบตรวจรูปแบบ CPE 2.3 หรือ purl ก่อนบันทึก
            </span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-4 pt-2 pb-4 sm:px-6 sm:pb-6">
          <Button
            variant="outline"
            data-testid="mapping-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            ยกเลิก
          </Button>
          <Button data-testid="mapping-save" disabled={busy} onClick={submit}>
            {save.isPending ? "กำลังบันทึก…" : "ยืนยัน"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
