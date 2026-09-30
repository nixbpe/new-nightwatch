import {
  canonicalSecretSlot,
  monitorIssueReason,
  monitorTestCreateSchema,
  monitorTestEditSchema,
  type MonitorConfigInput,
  type MonitorInvalidReason,
} from "@nightwatch/api-contract";
import { useEffect, useMemo, useRef, useState } from "react";

import type { EditBase, FormValues } from "./model";

// Secret values live only here, outside `FormValues`: React copies a controlled
// input's value into the DOM `value` attribute, and `FormValues` feeds the
// validation, the Test panel and the payloads. Inputs are uncontrolled and read
// from and write to this store.

export type SecretAccess = {
  get: (slot: string) => string;
  /** Changes with every write, so a field that remounts or is cleared re-reads its text. */
  version: number;
  set: (slot: string, value: string) => void;
  drop: (slots: string[]) => void;
};

export type SecretStore = SecretAccess & {
  /** True once any secret was typed, replaced or dropped since the last `markClean`. Holds no value or digest. */
  changed: boolean;
  markClean: () => void;
  clear: () => void;
};

export function useSecretStore(): SecretStore {
  const values = useRef(new Map<string, string>());
  const [version, setVersion] = useState(0);
  const [changed, setChanged] = useState(false);
  return useMemo(() => {
    const touch = () => {
      setChanged(true);
      setVersion((current) => current + 1);
    };
    return {
      version,
      changed,
      get: (slot) => values.current.get(slot) ?? "",
      set: (slot, value) => {
        values.current.set(slot, value);
        touch();
      },
      drop: (slots) => {
        let dropped = false;
        for (const slot of slots)
          dropped = values.current.delete(slot) || dropped;
        if (dropped) touch();
        else setVersion((current) => current + 1);
      },
      markClean: () => {
        setChanged(false);
      },
      clear: () => {
        values.current.clear();
        setVersion((current) => current + 1);
      },
    };
  }, [version, changed]);
}

/** Nothing typed stays in memory once the form is gone. */
export function useClearSecretsOnUnmount(store: SecretStore): void {
  const latest = useRef(store);
  latest.current = store;
  useEffect(
    () => () => {
      latest.current.clear();
    },
    [],
  );
}

export type RequiredSlot = {
  slot: string;
  /** Where its input and its errors sit (`auth.token`, `headers.2.value`). */
  path: string;
  label: string;
};

const AUTH_SLOTS = {
  none: [],
  bearer: [{ part: "token", label: "Token" }],
  basic: [
    { part: "username", label: "ชื่อผู้ใช้" },
    { part: "password", label: "รหัสผ่าน" },
  ],
  apiKey: [{ part: "apiKey", label: "ค่า API key" }],
} as const;

export const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "ไม่ใช้" },
  { value: "bearer", label: "Bearer token" },
  { value: "basic", label: "Basic" },
  { value: "apiKey", label: "API key header" },
] as const;

export function headerSlot(id: string): string {
  return canonicalSecretSlot(`header.${id}`);
}

export function isAuthSlot(slot: string): boolean {
  return slot.startsWith("auth.");
}

/** Slots the current configuration needs a value for: the auth type's and every secret header's. */
export function requiredSlots(
  values: Pick<FormValues, "auth" | "headers">,
): RequiredSlot[] {
  const slots: RequiredSlot[] = AUTH_SLOTS[values.auth.type].map((item) => ({
    slot: `auth.${item.part}`,
    path: `auth.${item.part}`,
    label: item.label,
  }));
  values.headers.forEach((header, index) => {
    if (header.secret && header.id !== undefined) {
      slots.push({
        slot: headerSlot(header.id),
        path: `headers.${String(index)}.value`,
        label: `ค่า header แถวที่ ${String(index + 1)}`,
      });
    }
  });
  return slots;
}

function storedSet(base: EditBase | null): Set<string> {
  return new Set(base?.secretSlots.map(canonicalSecretSlot) ?? []);
}

/** A slot takes a typed value when nothing is stored for it or the user chose to replace it. */
export function slotTakesValue(
  slot: string,
  base: EditBase | null,
  values: Pick<FormValues, "replacing">,
): boolean {
  return !storedSet(base).has(slot) || values.replacing.includes(slot);
}

/** Stored slots the current configuration still uses and the user is not replacing. */
export function keptSlots(
  values: Pick<FormValues, "auth" | "headers" | "replacing">,
  base: EditBase | null,
): string[] {
  const stored = storedSet(base);
  return requiredSlots(values)
    .map((item) => item.slot)
    .filter((slot) => stored.has(slot) && !values.replacing.includes(slot));
}

/** Stored slots the current configuration no longer uses: the server deletes them with the save. */
export function droppedSlots(
  values: Pick<FormValues, "auth" | "headers">,
  base: EditBase | null,
): string[] {
  const needed = new Set(requiredSlots(values).map((item) => item.slot));
  return [...storedSet(base)].filter((slot) => !needed.has(slot));
}

export type PlannedEntry =
  | { slot: string; path: string; action: "keep" }
  | { slot: string; path: string; action: "replace"; value: string }
  | { slot: string; path: string; action: "delete" };

/**
 * One entry per required slot (keep or replace) and a delete for every stored
 * slot that is no longer required, the only combination the server accepts.
 * Create has nothing stored, so it sends a value for each required slot.
 */
export function planEntries(
  values: FormValues,
  base: EditBase | null,
  get: (slot: string) => string,
): PlannedEntry[] {
  const entries: PlannedEntry[] = requiredSlots(values).map((item) =>
    slotTakesValue(item.slot, base, values)
      ? {
          slot: item.slot,
          path: item.path,
          action: "replace",
          value: get(item.slot),
        }
      : { slot: item.slot, path: item.path, action: "keep" },
  );
  for (const slot of droppedSlots(values, base)) {
    entries.push({ slot, path: "secrets", action: "delete" });
  }
  return entries;
}

export type CreateEntry = { slot: string; value: string };
export type EditEntry = {
  slot: string;
  action: "keep" | "replace" | "delete";
  value?: string;
};

/** Create takes only entries that hold a value; an empty required slot is the server's `required`. */
export function createEntries(entries: PlannedEntry[]): CreateEntry[] {
  return entries.flatMap((entry) =>
    entry.action === "replace" && entry.value !== ""
      ? [{ slot: entry.slot, value: entry.value }]
      : [],
  );
}

export function editEntries(entries: PlannedEntry[]): EditEntry[] {
  return entries.map((entry) =>
    entry.action === "replace"
      ? { slot: entry.slot, action: entry.action, value: entry.value }
      : { slot: entry.slot, action: entry.action },
  );
}

/** Which slots go with which action: the value-free part of a request the Test panel compares. */
export function secretShape(entries: PlannedEntry[]): string {
  return JSON.stringify(entries.map((entry) => [entry.slot, entry.action]));
}

export const REPLACE_EMPTY_MESSAGE = "กรอกค่าใหม่ หรือกดยกเลิกการแทนที่";
export const SECRET_EMPTY_MESSAGE = "กรอกค่าลับ";

/** An issue of the secret entries, placed at the input of its slot. */
export type SecretIssue = {
  path: string;
  /** The path the server would name for it, which picks the message. */
  entryPath: string;
  reason: MonitorInvalidReason;
  /** Set when the message is about an empty field rather than the field's rules. */
  message?: string;
};

const ENTRY_PATH = /^secrets\.(\d+)(?:\.(.+))?$/;

/** Places `secrets.N.*` errors at the slot's own path; `entries` is the array that was sent, in order. */
export function placeSecretPath(
  path: string,
  entries: readonly { slot: string; path: string }[],
): string {
  const match = ENTRY_PATH.exec(path);
  const entry =
    match?.[1] === undefined ? undefined : entries[Number(match[1])];
  return entry === undefined || entry.path === "secrets" ? path : entry.path;
}

/**
 * Empty required slots and the entry rules of the contract (length, line
 * breaks, unusable characters) for the values typed so far.
 */
export function secretIssues(
  values: FormValues,
  base: EditBase | null,
  get: (slot: string) => string,
  config: MonitorConfigInput,
): SecretIssue[] {
  const entries = planEntries(values, base, get);
  const issues: SecretIssue[] = [];
  const empty = new Set<string>();
  for (const entry of entries) {
    if (entry.action === "replace" && entry.value === "") {
      empty.add(entry.slot);
      issues.push({
        path: entry.path,
        entryPath: entry.path,
        reason: "required",
        message: values.replacing.includes(entry.slot)
          ? REPLACE_EMPTY_MESSAGE
          : SECRET_EMPTY_MESSAGE,
      });
    }
  }
  const sent = entries.filter(
    (entry) => !(entry.action === "replace" && empty.has(entry.slot)),
  );
  const parsed =
    base === null
      ? monitorTestCreateSchema.safeParse({
          ...config,
          secrets: createEntries(sent),
        })
      : monitorTestEditSchema.safeParse({
          ...config,
          secrets: editEntries(sent),
        });
  if (parsed.success) return issues;
  for (const issue of parsed.error.issues) {
    if (issue.path[0] !== "secrets") continue;
    const path = issue.path.join(".");
    issues.push({
      path: placeSecretPath(path, sent),
      entryPath: path,
      reason: monitorIssueReason(issue),
    });
  }
  return issues;
}
