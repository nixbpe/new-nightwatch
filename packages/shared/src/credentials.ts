import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { loadMonitorEnv, type MonitorEnv } from "./env";

/** Row identity bound into the ciphertext as AAD. */
export type SecretLocation = {
  tenantId: string;
  monitorId: string;
  slot: string;
};

/** Carries no plaintext, key or ciphertext material. */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

type CredentialEnv = Pick<
  MonitorEnv,
  "CREDENTIAL_ENCRYPTION_KEYS" | "CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION"
>;

const IV_BYTES = 12;
const TAG_BYTES = 16;

function aad({ tenantId, monitorId, slot }: SecretLocation): Buffer {
  const parts = [tenantId, monitorId, slot];
  if (parts.some((part) => part.length === 0 || part.includes("|"))) {
    throw new CredentialError("invalid secret location");
  }
  return Buffer.from(parts.join("|"), "utf8");
}

/**
 * AES-256-GCM with a random 12-byte IV and the active key. Output is
 * `<keyVersion>.<iv>.<tag>.<ciphertext>` (base64 parts) so a later key
 * rotation can still decrypt older values.
 */
export function encryptSecret(
  input: SecretLocation & { value: string },
  env: CredentialEnv = loadMonitorEnv(),
): string {
  const version = env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION;
  const key = env.CREDENTIAL_ENCRYPTION_KEYS[version];
  if (key === undefined) {
    throw new CredentialError("active credential key is not configured");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(aad(input));
  const ciphertext = Buffer.concat([
    cipher.update(input.value, "utf8"),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** Throws CredentialError for any tampered, mis-bound or unknown-key input. */
export function decryptSecret(
  input: SecretLocation & { ciphertext: string },
  env: CredentialEnv = loadMonitorEnv(),
): string {
  const fail = () => new CredentialError("secret cannot be decrypted");
  const parts = input.ciphertext.split(".");
  if (parts.length !== 4) throw fail();
  const [version, ivPart, tagPart, dataPart] = parts as [
    string,
    string,
    string,
    string,
  ];
  const key = Object.hasOwn(env.CREDENTIAL_ENCRYPTION_KEYS, version)
    ? env.CREDENTIAL_ENCRYPTION_KEYS[version]
    : undefined;
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  if (key === undefined || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw fail();
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "base64"),
      iv,
    );
    decipher.setAAD(aad(input));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw fail();
  }
}
