import {
  INVENTORY_ENVIRONMENTS,
  INVENTORY_EXPOSURES,
  INVENTORY_LAYERS,
  inventoryIssueMessage,
  type InventoryColumn,
  type InventoryRowInput,
  type InventoryRowItem,
  type InventorySystem,
} from "@nightwatch/api-contract";
import { useMutation } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Alert, Field, textInputClass } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  trapDialogTab,
  useDialogFocusReturn,
} from "../../components/ui/useDialogFocusReturn";
import { ApiError } from "../../lib/api/client";
import {
  createRow,
  createSystem,
  inventoryErrorMessage,
  inventoryRowIssues,
  updateRow,
} from "../../lib/api/inventory";
import { usePreferences } from "../../lib/preferences";
import { NO_SYSTEM_NAME } from "./format";
import { sourceLabel, sourceWho } from "./rowSource";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(",");

type Scope = { organizationId: string; projectId: string };
type FieldKey = keyof InventoryRowInput;

const EMPTY: InventoryRowInput = {
  owner: "",
  vendor: "",
  product: "",
  version: "",
  layer: "",
  environment: "",
  exposure: "",
};

const COLUMN_FIELD: Partial<Record<InventoryColumn, FieldKey>> = {
  Owner: "owner",
  Vendor: "vendor",
  Product: "product",
  Version: "version",
  Layer: "layer",
  Environment: "environment",
  Exposure: "exposure",
};

const LISTS: Partial<Record<FieldKey, readonly string[]>> = {
  layer: INVENTORY_LAYERS,
  environment: INVENTORY_ENVIRONMENTS,
  exposure: INVENTORY_EXPOSURES,
};

const TEXT_FIELDS: { key: FieldKey; label: string; mono?: boolean }[] = [
  { key: "owner", label: "Owner" },
  { key: "vendor", label: "Vendor" },
  { key: "product", label: "Product" },
  { key: "version", label: "Version", mono: true },
];

const LIST_FIELDS: { key: FieldKey; label: string }[] = [
  { key: "layer", label: "Layer" },
  { key: "environment", label: "Environment" },
  { key: "exposure", label: "Exposure" },
];

type Mode =
  | { kind: "add"; systems: InventorySystem[] }
  | { kind: "edit"; row: InventoryRowItem }
  // A new System: its name and its first row in one step.
  | { kind: "system" };

/**
 * Adds a row to a System, edits one, or creates a System with its first row. The server applies the upload's rules and answers
 * per column, so the reasons sit under their fields and what was typed stays. An edit
 * carries the revision of the row as it was when the dialog opened: if someone changed or
 * deleted the row since, the save is refused and nothing is overwritten.
 */
export function RowDialog({
  mode,
  scope,
  opener,
  fallbackFocus,
  onCancel,
  onSaved,
  onStale,
}: {
  mode: Mode;
  scope: Scope;
  opener: HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSaved: (message: string) => void;
  /** The row changed under the dialog: the table behind it should reload. */
  onStale: () => void;
}) {
  const { preferences } = usePreferences();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const editing = mode.kind === "edit" ? mode.row : null;
  const [values, setValues] = useState<InventoryRowInput>(
    editing === null
      ? EMPTY
      : {
          owner: editing.owner,
          vendor: editing.vendor,
          product: editing.product,
          version: editing.version,
          layer: editing.layer,
          environment: editing.environment,
          exposure: editing.exposure,
        },
  );
  const [systemId, setSystemId] = useState(
    mode.kind === "add" ? (mode.systems[0]?.id ?? "") : "",
  );
  // A row an upload kept as failing opens with its reasons already under the fields.
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>(
    () => {
      const first: Partial<Record<FieldKey, string>> = {};
      for (const issue of editing?.issues ?? []) {
        const field = COLUMN_FIELD[issue.column];
        if (field !== undefined) first[field] ??= inventoryIssueMessage(issue);
      }
      return first;
    },
  );
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useDialogFocusReturn(dialog, firstField, opener, fallbackFocus);

  const save = useMutation({
    mutationFn: (): Promise<unknown> =>
      mode.kind === "system"
        ? createSystem(scope.organizationId, scope.projectId, {
            name,
            ...values,
          })
        : editing === null
          ? createRow(scope.organizationId, scope.projectId, {
              systemId,
              ...values,
            })
          : updateRow(scope.organizationId, scope.projectId, editing.id, {
              ...values,
              revision: editing.revision,
            }),
    onMutate: () => {
      setNameError(null);
      setErrors({});
      setDuplicate(null);
      setGeneral(null);
    },
    onSuccess: () => {
      onSaved(
        mode.kind === "system"
          ? "เพิ่ม System แล้ว"
          : editing === null
            ? "เพิ่มแถวแล้ว"
            : "บันทึกแถวแล้ว",
      );
    },
    onError: (error) => {
      const issues = inventoryRowIssues(error);
      if (issues.length > 0) {
        const next: Partial<Record<FieldKey, string>> = {};
        const other: string[] = [];
        for (const issue of issues) {
          const field = COLUMN_FIELD[issue.column];
          const message = inventoryIssueMessage(issue);
          if (mode.kind === "system" && issue.column === "System") {
            setNameError(message);
          } else if (field === undefined) {
            other.push(`${issue.column}: ${message}`);
          } else {
            next[field] ??= message;
          }
        }
        setErrors(next);
        setGeneral(other.length === 0 ? null : other.join(" · "));
      } else if (
        error instanceof ApiError &&
        error.code === "INVENTORY_SYSTEM_NAME_TAKEN"
      ) {
        setNameError(error.message);
      } else if (
        error instanceof ApiError &&
        error.code === "INVENTORY_ROW_DUPLICATE"
      ) {
        setDuplicate(error.message);
      } else if (
        error instanceof ApiError &&
        error.code === "INVENTORY_ROW_STALE"
      ) {
        setStale(true);
        onStale();
        setGeneral(error.message);
      } else if (
        error instanceof ApiError &&
        error.code === "INVENTORY_SYSTEM_NOT_FOUND"
      ) {
        // Someone deleted the System the dialog was opened for.
        setStale(true);
        onStale();
        setGeneral(error.message);
      } else {
        setGeneral(inventoryErrorMessage(error));
      }
    },
  });

  // The Save button is disabled while it works and after a stale answer, which would drop
  // the focus to the page behind the dialog. After a failure it goes to the first field
  // with a reason, or the dialog itself.
  useEffect(() => {
    if (save.isPending) dialog.current?.focus();
    if (save.isError) {
      const invalid = dialog.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      (invalid ?? dialog.current)?.focus();
    }
  }, [save.isPending, save.isError]);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!save.isPending && !stale) save.mutate();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!save.isPending) onCancel();
      return;
    }
    trapDialogTab(event, dialog.current, FOCUSABLE);
  };
  const change = (key: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (key === "vendor" || key === "product" || key === "version") {
      setDuplicate(null);
    }
  };
  const keyInvalid = duplicate !== null;
  const system = mode.kind === "edit" ? mode.row.systemName : null;

  return createPortal(
    <div className="backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        ref={dialog}
        data-testid="inventory-row-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={save.isPending ? true : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="overlay-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-[640px] flex-col rounded-md border border-foreground/10 bg-surface text-foreground shadow-modal focus:outline-none"
      >
        <form
          noValidate
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-4 pt-4 sm:px-6 sm:pt-6">
            <h2 id={titleId} className="text-lg font-semibold text-heading">
              {mode.kind === "system"
                ? "เพิ่ม System"
                : editing === null
                  ? "เพิ่มแถว"
                  : "แก้แถว"}
            </h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-sm sm:px-6">
            {general === null ? null : (
              <Alert tone="error" data-testid="inventory-row-error">
                {general}
              </Alert>
            )}
            {mode.kind === "system" ? (
              <Field
                label="ชื่อ System"
                error={nameError}
                errorId="inventory-row-name-error"
                errorTestId="inventory-row-name-error"
              >
                <Input
                  ref={firstField}
                  data-testid="inventory-row-name"
                  value={name}
                  aria-invalid={nameError === null ? undefined : true}
                  aria-describedby={
                    nameError === null ? undefined : "inventory-row-name-error"
                  }
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameError(null);
                  }}
                />
              </Field>
            ) : mode.kind === "add" ? (
              <Field label="System">
                <select
                  data-testid="inventory-row-system"
                  className={textInputClass}
                  value={systemId}
                  onChange={(event) => {
                    setSystemId(event.target.value);
                  }}
                >
                  {mode.systems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name === "" ? NO_SYSTEM_NAME : item.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p className="text-[13px] text-foreground-secondary">
                System{" "}
                <span
                  data-testid="inventory-row-system-name"
                  className="font-medium text-foreground"
                >
                  {system === "" || system === null ? NO_SYSTEM_NAME : system}
                </span>
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {TEXT_FIELDS.map(({ key, label, mono }, index) => {
                const error =
                  errors[key] ?? (key === "version" ? duplicate : null);
                const invalid =
                  errors[key] !== undefined ||
                  (keyInvalid &&
                    (key === "vendor" ||
                      key === "product" ||
                      key === "version"));
                return (
                  <Field
                    key={key}
                    label={label}
                    error={error}
                    errorId={`inventory-row-${key}-error`}
                    errorTestId={`inventory-row-${key}-error`}
                    className={
                      key === "version" && duplicate !== null
                        ? "sm:col-span-2"
                        : undefined
                    }
                  >
                    <Input
                      ref={
                        index === 0 && mode.kind !== "system"
                          ? firstField
                          : undefined
                      }
                      data-testid={`inventory-row-${key}`}
                      value={values[key]}
                      aria-invalid={invalid ? true : undefined}
                      aria-describedby={
                        error === null
                          ? undefined
                          : `inventory-row-${key}-error`
                      }
                      className={
                        mono === true ? "font-mono text-[14px]" : undefined
                      }
                      onChange={(event) => {
                        change(key, event.target.value);
                      }}
                    />
                  </Field>
                );
              })}
              {LIST_FIELDS.map(({ key, label }) => (
                <Field
                  key={key}
                  label={label}
                  error={errors[key] ?? null}
                  errorId={`inventory-row-${key}-error`}
                  errorTestId={`inventory-row-${key}-error`}
                >
                  <select
                    data-testid={`inventory-row-${key}`}
                    className={textInputClass}
                    value={values[key]}
                    aria-invalid={errors[key] === undefined ? undefined : true}
                    aria-describedby={
                      errors[key] === undefined
                        ? undefined
                        : `inventory-row-${key}-error`
                    }
                    onChange={(event) => {
                      change(key, event.target.value);
                    }}
                  >
                    <option value="">เลือก</option>
                    {/* A value an upload kept outside the list stays selected, with its reason. */}
                    {values[key] !== "" &&
                    LISTS[key]?.includes(values[key]) === false ? (
                      <option value={values[key]}>{values[key]}</option>
                    ) : null}
                    {LISTS[key]?.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2 pb-4 sm:px-6 sm:pb-6">
            <p
              data-testid="inventory-row-source"
              className="min-w-0 text-xs break-words text-foreground-secondary"
            >
              {editing === null ? null : (
                <>
                  {sourceLabel(editing.source)}
                  <br />
                  <span className="font-mono">
                    {sourceWho(editing.source, preferences)}
                  </span>
                </>
              )}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                data-testid="inventory-row-cancel"
                disabled={save.isPending}
                onClick={onCancel}
              >
                ยกเลิก
              </Button>
              <Button
                type="submit"
                data-testid="inventory-row-save"
                disabled={save.isPending || stale}
              >
                {save.isPending ? "กำลังบันทึก…" : "บันทึก"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
