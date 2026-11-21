#!/usr/bin/env bash
set -euo pipefail

# Local-only emulator. In v0.52.0 the strict front gate lacks the ExternalId
# context needed by cross-account role trust; the STS handler has that context
# and still rejects bad ExternalIds in soft mode. Keep SigV4 enabled.
image=ghcr.io/faiscadev/fakecloud@sha256:9be41fb9274d792dcd1de6914177021edb5d5fea168ceceb28793543ffeede2a
cid=$(docker run -d --rm -e FAKECLOUD_IAM=soft -e FAKECLOUD_VERIFY_SIGV4=true -p 127.0.0.1::4566 "$image")
trap 'docker stop "$cid" >/dev/null' EXIT
endpoint=http://$(docker port "$cid" 4566/tcp)

admin() {
  curl --max-time 2 -fsS "$endpoint/_fakecloud/iam/create-admin" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg a "$1" --arg u "$2" '{accountId:$a,userName:$u}')"
}

# Use only run-created emulator credentials, never the caller's AWS profile.
iam() {
  local keys=$1
  shift
  env -i PATH="$PATH" HOME=/var/empty AWS_EC2_METADATA_DISABLED=true \
    AWS_ACCESS_KEY_ID="$(jq -er .accessKeyId <<< "$keys")" \
    AWS_SECRET_ACCESS_KEY="$(jq -er .secretAccessKey <<< "$keys")" \
    aws --no-cli-pager --region us-east-1 --endpoint-url "$endpoint" iam "$@"
}

trust() {
  jq -nc --arg principal "$1" --arg externalId "$2" '{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{AWS:$principal},Action:"sts:AssumeRole",Condition:{StringEquals:{"sts:ExternalId":$externalId}}}]}'
}

for attempt in {1..20}; do
  if source_keys=$(admin 111111111111 source 2>/dev/null); then break; fi
  if [ "$attempt" = 20 ]; then echo 'fakecloud did not become ready' >&2; exit 1; fi
  sleep 1
done
hub_keys=$(admin 222222222222 hub)
project_keys=$(admin 333333333333 project)
hub_arn=$(iam "$hub_keys" create-role --role-name Hub \
  --assume-role-policy-document "$(trust arn:aws:iam::111111111111:user/source nw-org-fixture)" \
  --query Role.Arn --output text)
project_arn=$(iam "$project_keys" create-role --role-name Project \
  --assume-role-policy-document "$(trust "$hub_arn" nw-project-fixture)" \
  --query Role.Arn --output text)
iam "$hub_keys" put-role-policy --role-name Hub --policy-name AssumeProject \
  --policy-document "$(jq -nc --arg arn "$project_arn" '{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"sts:AssumeRole",Resource:$arn}]}')"

cd "$(dirname "$0")/.."
TEST_ENDPOINT=$endpoint TEST_SOURCE_KEYS=$source_keys TEST_PROJECT_KEYS=$project_keys \
  TEST_HUB_ARN=$hub_arn TEST_PROJECT_ARN=$project_arn bun -e '
  import { strict as assert } from "node:assert";
  import { STS } from "@aws-sdk/client-sts";
  import { createStsVerifier } from "./src/aws/sts";

  const { TEST_ENDPOINT: endpoint, TEST_SOURCE_KEYS, TEST_PROJECT_KEYS, TEST_HUB_ARN, TEST_PROJECT_ARN } = process.env;
  assert.match(endpoint ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(TEST_SOURCE_KEYS && TEST_PROJECT_KEYS && TEST_HUB_ARN && TEST_PROJECT_ARN);
  const keys = (value) => {
    const { accessKeyId, secretAccessKey } = JSON.parse(value);
    return { accessKeyId, secretAccessKey };
  };
  const source = new STS({ endpoint, region: "us-east-1", credentials: keys(TEST_SOURCE_KEYS), maxAttempts: 1 });
  const verifier = createStsVerifier(async (abortSignal) => {
    const result = await source.getSessionToken({}, { abortSignal });
    const { AccessKeyId, SecretAccessKey, SessionToken } = result.Credentials ?? {};
    assert.ok(AccessKeyId && SecretAccessKey && SessionToken);
    return { accessKeyId: AccessKeyId, secretAccessKey: SecretAccessKey, sessionToken: SessionToken };
  }, (region, credentials) => new STS({ endpoint, region, credentials, maxAttempts: 1 }));
  const hub = { roleArn: TEST_HUB_ARN, externalId: "nw-org-fixture" };
  const project = { roleArn: TEST_PROJECT_ARN, externalId: "nw-project-fixture" };
  assert.equal((await verifier.organization(hub)).arn,
    "arn:aws:sts::222222222222:assumed-role/Hub/NightWatchConnectionTest");
  assert.equal((await verifier.projectRole(hub, project)).arn,
    "arn:aws:sts::333333333333:assumed-role/Project/NightWatchConnectionTest");
  assert.equal((await verifier.accessKey("us-east-1", keys(TEST_PROJECT_KEYS))).arn,
    "arn:aws:iam::333333333333:user/project");
  await assert.rejects(verifier.organization({ ...hub, externalId: "wrong-external-id" }),
    { code: "AWS_ACCESS_DENIED" });
  await assert.rejects(verifier.projectRole(hub, { ...project, externalId: "wrong-external-id" }),
    { code: "AWS_ACCESS_DENIED" });
  console.log("fakecloud: cross-account chain, IAM user identity, and ExternalId rejection passed");
'
