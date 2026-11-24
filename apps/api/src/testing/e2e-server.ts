// Test-only API entry for the browser e2e suite (e2e/playwright.config.ts):
// the production bootstrap with an STS verifier against the local fakecloud
// emulator. src/index.ts and src/server.ts never import this file
// (entry-isolation.test.ts), so no env switch, flag or request reaches it.
import { STS } from "@aws-sdk/client-sts";
import { createStsVerifier, loadEnv, StsError } from "@nightwatch/shared";

import { startApi } from "../server";
import { e2eResolver } from "./e2e-resolver";

if (loadEnv().NODE_ENV === "production") {
  throw new Error("the e2e API entry refuses NODE_ENV=production");
}
const endpoint = process.env.FAKECLOUD_ENDPOINT ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
  throw new Error("FAKECLOUD_ENDPOINT must be a loopback fakecloud URL");
}

// The NightWatch principal is a run-created emulator user; the page's trust
// policy names it, so the suite can paste that policy into fakecloud.
const SOURCE = { accountId: "111111111111", userName: "nightwatch" };
async function sourceKeys(): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  arn: string;
}> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/_fakecloud/iam/create-admin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SOURCE),
      });
      if (response.ok)
        return (await response.json()) as {
          accessKeyId: string;
          secretAccessKey: string;
          arn: string;
        };
    } catch {
      // Not listening yet.
    }
    if (attempt === 60) throw new Error("fakecloud did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
const source = await sourceKeys();
const sourceSts = new STS({
  endpoint,
  region: "us-east-1",
  credentials: {
    accessKeyId: source.accessKeyId,
    secretAccessKey: source.secretAccessKey,
  },
  maxAttempts: 1,
});
const awsSts = createStsVerifier(
  async (abortSignal) => {
    const { Credentials } = await sourceSts.getSessionToken(
      {},
      { abortSignal },
    );
    if (
      !Credentials?.AccessKeyId ||
      !Credentials.SecretAccessKey ||
      !Credentials.SessionToken
    )
      throw new StsError("AWS_UNKNOWN");
    return {
      accessKeyId: Credentials.AccessKeyId,
      secretAccessKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
    };
  },
  (region, credentials) =>
    new STS({ endpoint, region, credentials, maxAttempts: 1 }),
);

await startApi({ awsSts, awsPrincipalArn: source.arn, resolver: e2eResolver });
