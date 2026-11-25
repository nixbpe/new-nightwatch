import {
  cpeNameSchema,
  purlSchema,
  type CpeCandidate,
  type InventoryMapping,
} from "@nightwatch/api-contract";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Alert, Field, Input } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  decideMapping,
  inventoryErrorMessage,
  searchCpe,
} from "../../lib/api/inventory";

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
  const searchInput = useRef<HTMLInputElement>(null);
  const cpeInput = useRef<HTMLInputElement>(null);
  const purlInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(
    `${mapping.vendor} ${mapping.product}`.slice(0, 100),
  );
  const [candidates, setCandidates] = useState<CpeCandidate[] | null>(null);
  const [picked, setPicked] = useState<string | null>(mapping.cpe);
  const [typedCpe, setTypedCpe] = useState("");
  const [typedPurl, setTypedPurl] = useState("");
  const [errors, setErrors] = useState<{ cpe?: string; purl?: string }>({});

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

  // Search and Save are disabled while busy; a disabled button drops focus to the page behind,
  // where Escape and the Tab trap no longer reach the dialog. Keep focus on the panel.
  useEffect(() => {
    if (busy) panel.current?.focus();
  }, [busy]);

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
    if (next.cpe !== undefined || next.purl !== undefined) {
      // The first field with a reason takes focus, as in the row dialog.
      (next.cpe === undefined ? purlInput : cpeInput).current?.focus();
      return;
    }
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
      cpeInput.current?.focus();
      return;
    }
    save.mutate(chosen);
  };

  return (
    <Dialog
      data-testid="mapping-dialog"
      size="xl"
      title="แก้ CPE/purl"
      description={`${mapping.vendor} · ${mapping.product}${
        mapping.systems.length === 0 ? "" : ` · ${mapping.systems.join(", ")}`
      }`}
      busy={busy}
      opener={opener}
      fallbackFocus={fallbackFocus}
      initialFocus={searchInput}
      dialogRef={panel}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm sm:px-6">
        {search.isError ? (
          <Alert tone="error" data-testid="mapping-search-error">
            {inventoryErrorMessage(search.error)}
          </Alert>
        ) : null}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim().length >= 2 && !busy) search.mutate();
          }}
        >
          <Field htmlFor="mapping-query" label="ค้นใน NVD CPE dictionary">
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
          </Field>
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
                ไม่พบใน dictionary กรอก CPE หรือ purl เอง หรือปิดแล้วเลือก
                "ไม่มี CPE/purl" ที่หน้าคิว
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
                  <span className="flex min-w-0 flex-1 flex-col">
                    {candidate.title === null ? null : (
                      <span
                        data-testid="mapping-candidate-title"
                        className="text-sm"
                      >
                        {candidate.title}
                      </span>
                    )}
                    <span className="font-mono text-[13px] break-all">
                      {candidate.cpe}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-foreground-secondary">
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </label>
              ))
            )}
          </fieldset>
        )}
        <Field
          htmlFor="mapping-cpe"
          label="หรือกรอก CPE 2.3 เอง"
          error={errors.cpe}
          errorId="mapping-cpe-error"
          errorTestId="mapping-cpe-error"
        >
          <Input
            id="mapping-cpe"
            ref={cpeInput}
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
        </Field>
        <Field
          htmlFor="mapping-purl"
          label={
            <>
              หรือกรอก purl เอง{" "}
              <span className="font-normal text-foreground-secondary">
                (package ของ distro)
              </span>
            </>
          }
          help="ถ้ากรอก CPE หรือ purl ระบบใช้ค่าที่กรอกแทนผลการค้น และตรวจรูปแบบก่อนบันทึก"
          helpId="mapping-purl-help"
          error={errors.purl}
          errorId="mapping-purl-error"
          errorTestId="mapping-purl-error"
        >
          <Input
            id="mapping-purl"
            ref={purlInput}
            data-testid="mapping-purl"
            value={typedPurl}
            maxLength={512}
            aria-invalid={errors.purl === undefined ? undefined : true}
            aria-describedby={
              errors.purl === undefined
                ? "mapping-purl-help"
                : "mapping-purl-help mapping-purl-error"
            }
            className="font-mono text-[14px]"
            placeholder="pkg:deb/ubuntu/openssl@3.0.2-0ubuntu1.10?distro=ubuntu-22.04"
            onChange={(event) => {
              setTypedPurl(event.target.value);
            }}
          />
        </Field>
      </div>
      {save.isError ? (
        <div className="px-4 pt-2 sm:px-6">
          <Alert tone="error" data-testid="mapping-save-error">
            {inventoryErrorMessage(save.error)}
          </Alert>
        </div>
      ) : null}
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
    </Dialog>
  );
}
