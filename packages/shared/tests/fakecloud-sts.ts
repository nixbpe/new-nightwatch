import { STS } from "@aws-sdk/client-sts";
import { z } from "zod";

import { createStsVerifier } from "../src/aws/sts";

export const fixtureKeysSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
});
export const fixtureEndpointSchema = z
  .string()
  .regex(/^http:\/\/127\.0\.0\.1:\d+$/);

export function fakecloudVerifier(
  rawEndpoint: string | undefined,
  rawKeys: string | undefined,
) {
  const endpoint = fixtureEndpointSchema.parse(rawEndpoint);
  const keys = fixtureKeysSchema.parse(JSON.parse(rawKeys ?? "null"));
  return createStsVerifier(
    async (abortSignal) => {
      const client = new STS({
        endpoint,
        region: "us-east-1",
        credentials: keys,
        maxAttempts: 1,
      });
      try {
        const { Credentials } = await client.getSessionToken(
          {},
          { abortSignal },
        );
        if (
          !Credentials?.AccessKeyId ||
          !Credentials.SecretAccessKey ||
          !Credentials.SessionToken
        )
          throw new Error("fakecloud did not return temporary credentials");
        return {
          accessKeyId: Credentials.AccessKeyId,
          secretAccessKey: Credentials.SecretAccessKey,
          sessionToken: Credentials.SessionToken,
        };
      } finally {
        client.destroy();
      }
    },
    (region, credentials) =>
      new STS({ endpoint, region, credentials, maxAttempts: 1 }),
  );
}
