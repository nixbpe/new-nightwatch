import { createHash } from "node:crypto";

/** The length of the key columns; the inventory contract has the same 200 (see rows.test.ts). */
export const IDENTITY_KEY_MAX_LENGTH = 200;

// The Project-wide identity of a System, a vendor or a product. Lower-casing can lengthen
// a name past the 200 characters the key column holds, and cutting it would give two names
// one key, so a longer key is replaced by its hash. The hash key starts with a control
// character, which a normalized name never contains, so a hash key can never equal the key
// of a name typed as that text.
export function identityKey(text: string): string {
  const lower = text.toLowerCase();
  return Array.from(lower).length <= IDENTITY_KEY_MAX_LENGTH
    ? lower
    : `\u0001sha256:${createHash("sha256").update(lower).digest("hex")}`;
}
