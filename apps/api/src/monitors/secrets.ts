import {
  canonicalSecretSlot,
  type MonitorInvalidReason,
  type StoredHeader,
} from "@nightwatch/api-contract";
import { AppError, buildCheckUrl } from "@nightwatch/shared";

import type { MonitorRow } from "./record";

export type SecretEntry = {
  slot: string;
  action: "keep" | "replace" | "delete";
  value?: string;
};

type Requirement = { slot: string; field: string };

/**
 * Slots the saved config needs a value for. `field` is where the client types
 * the value, so a missing value is reported next to it.
 */
export function requiredSlots(
  config: Pick<MonitorRow, "authType" | "headers">,
): Requirement[] {
  const slots: Requirement[] = [];
  const auth = (slot: string): void => {
    slots.push({ slot: `auth.${slot}`, field: "auth" });
  };
  if (config.authType === "bearer") auth("token");
  if (config.authType === "basic") {
    auth("username");
    auth("password");
  }
  if (config.authType === "apiKey") auth("apiKey");
  config.headers.forEach((header: StoredHeader, index) => {
    if (header.secret && header.id !== undefined) {
      slots.push({
        slot: `header.${header.id.toLowerCase()}`,
        field: `headers.${String(index)}.value`,
      });
    }
  });
  return slots;
}

export type SecretPlan = {
  /** Values to encrypt and upsert, by canonical slot. */
  writes: { slot: string; value: string }[];
  keeps: string[];
  /** Stored slots the saved config no longer uses. */
  deletes: string[];
};

function invalid(fields: { field: string; reason: MonitorInvalidReason }[]) {
  return new AppError(400, "MONITOR_INVALID", "Invalid monitor input", {
    fields,
  });
}

/**
 * Checks the entries against the saved config and the stored slots (AC-26).
 * `save` enforces the required rule; `test` leaves a missing slot to the
 * executor, which reports it as a check error.
 */
export function planSecrets(input: {
  required: Requirement[];
  entries: SecretEntry[];
  stored: ReadonlySet<string>;
  mode: "save" | "test";
}): SecretPlan {
  const save = input.mode === "save";
  const needed = new Map(input.required.map((entry) => [entry.slot, entry]));
  const fields: { field: string; reason: MonitorInvalidReason }[] = [];
  const writes: SecretPlan["writes"] = [];
  const keeps: string[] = [];
  const covered = new Set<string>();

  input.entries.forEach((entry, index) => {
    const slot = canonicalSecretSlot(entry.slot);
    const at = (part?: string): string =>
      `secrets.${String(index)}${part === undefined ? "" : `.${part}`}`;
    const required = needed.has(slot);
    if (entry.action === "delete") {
      // Deleting what the config still needs would leave a required slot empty.
      if (required) fields.push({ field: at("slot"), reason: "required" });
      return;
    }
    if (!required) {
      fields.push({ field: at("slot"), reason: "invalid_format" });
      return;
    }
    if (entry.action === "keep") {
      if (save && !input.stored.has(slot)) {
        covered.add(slot);
        fields.push({ field: at(), reason: "required" });
        return;
      }
      keeps.push(slot);
    } else {
      writes.push({ slot, value: entry.value ?? "" });
    }
    covered.add(slot);
  });

  if (save) {
    for (const { slot, field } of input.required) {
      if (!covered.has(slot)) fields.push({ field, reason: "required" });
    }
  }
  if (fields.length > 0) throw invalid(fields);
  return {
    writes,
    keeps,
    deletes: [...input.stored].filter((slot) => !needed.has(slot)),
  };
}

/** Same normalization as the executor: WHATWG origin of the built URL. */
function originOf(config: {
  url: string;
  queryParams: { name: string; value: string }[];
}): string | null {
  const built = buildCheckUrl(config.url, config.queryParams);
  if (built.ok) return built.url.origin;
  // A forbidden address is a result of the check, not a different origin.
  return built.reason === "blocked_address" && URL.canParse(config.url)
    ? new URL(config.url).origin
    : null;
}

/** A path or query change keeps the origin; anything unparsable counts as changed. */
export function sameOrigin(
  previous: Parameters<typeof originOf>[0],
  next: Parameters<typeof originOf>[0],
): boolean {
  const before = originOf(previous);
  return before !== null && before === originOf(next);
}

export function assertSameOrigin(
  previous: Parameters<typeof originOf>[0],
  next: Parameters<typeof originOf>[0],
): void {
  if (!sameOrigin(previous, next)) {
    throw new AppError(
      422,
      "MONITOR_SECRET_ORIGIN_CHANGED",
      "ปลายทางเปลี่ยนแล้ว กรอกค่าลับใหม่หรือลบค่าลับก่อน",
    );
  }
}
