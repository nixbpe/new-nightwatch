import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { createStsVerifier, StsError } from "@nightwatch/shared";

import { startApi } from "./server";

// The workload's default credential chain (web identity, container or
// instance role). Production has no fake client, endpoint override or switch;
// only tests inject another verifier (TS-003).
const workloadCredentials = defaultProvider();
const awsSts = createStsVerifier(async () => {
  const { accessKeyId, secretAccessKey, sessionToken } =
    await workloadCredentials();
  if (!sessionToken) throw new StsError("AWS_UNKNOWN");
  return { accessKeyId, secretAccessKey, sessionToken };
});

await startApi({ awsSts });
