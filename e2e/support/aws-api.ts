import { rmSync, writeFileSync } from "node:fs";

import { startApi } from "../../apps/api/src/bootstrap";
import {
  fakecloudVerifier,
  fixtureEndpointSchema,
  fixtureKeysSchema,
} from "../../packages/shared/tests/fakecloud-sts";

const file = process.env.NIGHTWATCH_E2E_STS_FIXTURE;
if (process.env.NODE_ENV === "production" || !file)
  throw new Error("AWS E2E requires an isolated test launch");
const endpoint = fixtureEndpointSchema.parse(process.env.TEST_ENDPOINT);
const sts = fakecloudVerifier(endpoint, process.env.TEST_SOURCE_KEYS);
const browserKeys = fixtureKeysSchema.parse(
  JSON.parse(process.env.TEST_BROWSER_KEYS ?? "null"),
);
writeFileSync(file, JSON.stringify(browserKeys), { mode: 0o600, flag: "wx" });
process.on("exit", () => {
  rmSync(file, { force: true });
});
await startApi({ sts, principalArn: "arn:aws:iam::111111111111:user/source" });
