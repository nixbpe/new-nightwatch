import { createHash, createHmac } from "node:crypto";

import { resolvePorts } from "../../scripts/ports.mjs";

// Local STS/IAM emulator from PR #118 (packages/shared/tests/sts-fakecloud.integration.sh).
// Soft IAM still rejects a wrong ExternalId in the STS handler; SigV4 stays verified.
export const FAKECLOUD_IMAGE =
  "ghcr.io/faiscadev/fakecloud@sha256:9be41fb9274d792dcd1de6914177021edb5d5fea168ceceb28793543ffeede2a";

/** `FAKECLOUD_PORT`, else 4600 + the worktree slot (scripts/ports.mjs). */
export function fakecloudPort(env = process.env): number {
  return env.FAKECLOUD_PORT
    ? Number(env.FAKECLOUD_PORT)
    : 4600 + resolvePorts(env).slot;
}

export const fakecloudEndpoint = `http://127.0.0.1:${String(fakecloudPort())}`;

/** The account and user the e2e API entry signs in as; the trust policy names this ARN. */
export const NIGHTWATCH_SOURCE = {
  accountId: "111111111111",
  userName: "nightwatch",
  arn: "arn:aws:iam::111111111111:user/nightwatch",
} as const;

type Keys = { accessKeyId: string; secretAccessKey: string };

/** Unsigned emulator admin call; returns run-created keys, never the caller's AWS profile. */
export async function createAdmin(
  accountId: string,
  userName: string,
): Promise<Keys> {
  const response = await fetch(
    `${fakecloudEndpoint}/_fakecloud/iam/create-admin`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId, userName }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `fakecloud create-admin failed: ${String(response.status)}`,
    );
  }
  return (await response.json()) as Keys;
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();

// SigV4 for one IAM Query call, so the suite needs no AWS SDK or CLI.
async function iam(
  keys: Keys,
  params: Record<string, string>,
): Promise<string> {
  const body = new URLSearchParams({ Version: "2010-05-08", ...params })
    .toString()
    .replaceAll("+", "%20");
  const host = new URL(fakecloudEndpoint).host;
  const amzDate = new Date().toISOString().replaceAll(/[:-]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/us-east-1/iam/aws4_request`;
  const contentType = "application/x-www-form-urlencoded; charset=utf-8";
  const signedHeaders = "content-type;host;x-amz-date";
  const canonical = [
    "POST",
    "/",
    "",
    `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    sha256(body),
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join(
    "\n",
  );
  let key = hmac(`AWS4${keys.secretAccessKey}`, amzDate.slice(0, 8));
  for (const part of ["us-east-1", "iam", "aws4_request"])
    key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const response = await fetch(`${fakecloudEndpoint}/`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`fakecloud IAM ${params.Action ?? ""} failed: ${text}`);
  }
  return text;
}

/** Creates a role whose trust policy is the document the page offers to copy. */
export async function createRole(
  keys: Keys,
  roleName: string,
  trustPolicy: string,
): Promise<string> {
  const xml = await iam(keys, {
    Action: "CreateRole",
    RoleName: roleName,
    AssumeRolePolicyDocument: trustPolicy,
  });
  const arn = /<Arn>([^<]+)<\/Arn>/.exec(xml)?.[1];
  if (arn === undefined)
    throw new Error("fakecloud CreateRole returned no ARN");
  return arn;
}
