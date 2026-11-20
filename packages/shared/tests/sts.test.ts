import { STS } from "@aws-sdk/client-sts";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { createStsVerifier, StsError, stsTransport } from "../src/aws/sts";
import * as outbound from "../src/outbound-http/send";

type ClientFactory = NonNullable<Parameters<typeof createStsVerifier>[1]>;
const hub = {
  roleArn: "arn:aws:iam::111111111111:role/Hub",
  externalId: "hub-test",
};
const project = {
  roleArn: "arn:aws:iam::222222222222:role/Project",
  externalId: "project-test",
};
const keys = { accessKeyId: "test", secretAccessKey: "test" };
const source = { ...keys, sessionToken: "fixture-source" };
const workload = () => Promise.resolve(source);

function fixture() {
  const destroy = vi.fn();
  const assumeRole = vi
    .fn<ReturnType<ClientFactory>["assumeRole"]>()
    .mockResolvedValueOnce({
      $metadata: {},
      Credentials: {
        Expiration: new Date(0),
        AccessKeyId: "hub",
        SecretAccessKey: "secret",
        SessionToken: "hub-token",
      },
    })
    .mockResolvedValueOnce({
      $metadata: {},
      Credentials: {
        Expiration: new Date(0),
        AccessKeyId: "project",
        SecretAccessKey: "secret",
        SessionToken: "project-token",
      },
    });
  const getCallerIdentity = vi.fn().mockResolvedValue({
    Account: "222222222222",
    Arn: "arn:aws:sts::222222222222:assumed-role/Project/NightWatchConnectionTest",
  });
  const factory = vi.fn<ClientFactory>(() => ({
    assumeRole,
    getCallerIdentity,
    destroy,
  }));
  return {
    verifier: createStsVerifier(workload, factory),
    factory,
    assumeRole,
    getCallerIdentity,
    destroy,
  };
}

describe("AWS STS verifier", () => {
  it("uses scoped credentials for each step and returns identity only", async () => {
    const { verifier, factory, assumeRole, destroy } = fixture();
    await expect(verifier.projectRole(hub, project)).resolves.toEqual({
      accountId: "222222222222",
      arn: "arn:aws:sts::222222222222:assumed-role/Project/NightWatchConnectionTest",
    });
    expect(
      factory.mock.calls.map(([region, credentials]) => [
        region,
        credentials.accessKeyId,
      ]),
    ).toEqual([
      ["us-east-1", "test"],
      ["us-east-1", "hub"],
      ["us-east-1", "project"],
    ]);
    expect(
      assumeRole.mock.calls.map(([input]) => [input.RoleArn, input.ExternalId]),
    ).toEqual([
      [hub.roleArn, hub.externalId],
      [project.roleArn, project.externalId],
    ]);
    expect(destroy).toHaveBeenCalledTimes(3);
  });

  it("rejects unsupported regions before opening an STS client", async () => {
    const { verifier, factory } = fixture();
    await expect(verifier.accessKey("cn-north-1", keys)).rejects.toThrow(
      "AWS_REGION_DISABLED",
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it("pins the regional endpoint modes despite ambient SDK configuration", async () => {
    vi.stubEnv("AWS_USE_FIPS_ENDPOINT", "true");
    vi.stubEnv("AWS_USE_DUALSTACK_ENDPOINT", "true");
    vi.stubEnv("AWS_ENDPOINT_URL_STS", "https://ambient.invalid");
    const prototype: Pick<
      ReturnType<ClientFactory>,
      "getCallerIdentity"
    > = STS.prototype;
    const identity = vi
      .spyOn(prototype, "getCallerIdentity")
      .mockImplementation(async function (this: STS) {
        expect(await this.config.useFipsEndpoint()).toBe(false);
        expect(await this.config.useDualstackEndpoint()).toBe(false);
        expect(await this.config.endpoint?.()).toMatchObject({
          protocol: "https:",
          hostname: "sts.us-east-1.amazonaws.com",
        });
        return { Account: "222222222222", Arn: project.roleArn, $metadata: {} };
      });
    try {
      await expect(
        createStsVerifier(workload).accessKey("us-east-1", keys),
      ).resolves.toEqual({
        accountId: "222222222222",
        arn: project.roleArn,
      });
      expect(identity).toHaveBeenCalledOnce();
    } finally {
      identity.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("uses the production transport once without probing metadata in ambient auto mode", async () => {
    const metadataHit = vi.fn();
    const metadata = createServer((_request, response) => {
      metadataHit();
      response.writeHead(404).end();
    });
    metadata.listen(0, "127.0.0.1");
    await once(metadata, "listening");
    const address = metadata.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const body = (xml: string, status: number) => ({
      ok: true,
      response: {
        remoteAddress: "192.0.2.1",
        httpVersion: "HTTP/1.1" as const,
        headers: { "content-type": "text/xml" },
        status,
        reasonPhrase: null,
        body: Buffer.from(xml),
        bodyTruncated: false,
        finalUrl: "https://sts.us-east-1.amazonaws.com/",
        redirects: 0,
        elapsedMs: 1,
      },
    });
    const send = vi
      .spyOn(outbound, "sendOutboundRequest")
      .mockResolvedValue(
        body(
          "<ErrorResponse><Error><Code>ServiceUnavailable</Code></Error></ErrorResponse>",
          503,
        ),
      );
    vi.stubEnv("AWS_DEFAULTS_MODE", "auto");
    vi.stubEnv("AWS_RETRY_MODE", undefined);
    vi.stubEnv("AWS_CONFIG_FILE", "/dev/null");
    vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", "/dev/null");
    vi.stubEnv("AWS_PROFILE", undefined);
    vi.stubEnv("AWS_EXECUTION_ENV", undefined);
    vi.stubEnv("AWS_REGION", undefined);
    vi.stubEnv("AWS_DEFAULT_REGION", undefined);
    vi.stubEnv("AWS_EC2_METADATA_DISABLED", undefined);
    vi.stubEnv(
      "AWS_EC2_METADATA_SERVICE_ENDPOINT",
      `http://127.0.0.1:${String(address.port)}`,
    );
    try {
      const verifier = createStsVerifier(workload);
      await expect(verifier.accessKey("us-east-1", keys)).rejects.toThrow(
        "AWS_UNKNOWN",
      );
      expect(send).toHaveBeenCalledOnce();
      send
        .mockClear()
        .mockResolvedValue(
          body(
            `<GetCallerIdentityResponse><GetCallerIdentityResult><Account>222222222222</Account><Arn>${project.roleArn}</Arn><UserId>fixture</UserId></GetCallerIdentityResult></GetCallerIdentityResponse>`,
            200,
          ),
        );
      await expect(verifier.accessKey("us-east-1", keys)).resolves.toEqual({
        accountId: "222222222222",
        arn: project.roleArn,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(metadataHit).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      vi.unstubAllEnvs();
      metadata.close();
      metadata.closeAllConnections();
    }
  });

  it("passes signed STS requests through the shared outbound policy", async () => {
    const send = vi
      .fn<NonNullable<Parameters<typeof stsTransport>[0]>>()
      .mockResolvedValue({
        ok: false,
        failure: { reason: "blocked_address", message: "blocked" },
      });
    const verifier = createStsVerifier(
      workload,
      (region, credentials) =>
        new STS({
          region,
          credentials,
          maxAttempts: 1,
          requestHandler: stsTransport(send),
        }),
    );
    await expect(verifier.organization(hub)).rejects.toThrow("AWS_UNKNOWN");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      url: "https://sts.us-east-1.amazonaws.com/",
      method: "POST",
      maxRedirects: 0,
      headers: { "x-amz-security-token": source.sessionToken },
    });
    expect(send.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a private resolved peer via the real outbound helper", async () => {
    const resolver = vi
      .fn<(hostname: string) => Promise<string[]>>()
      .mockResolvedValue(["127.0.0.1"]);
    const send = vi.fn(
      (request: Parameters<typeof outbound.sendOutboundRequest>[0]) =>
        outbound.sendOutboundRequest(request, { resolver }),
    );
    const verifier = createStsVerifier(
      workload,
      (region, credentials) =>
        new STS({
          region,
          credentials,
          maxAttempts: 1,
          requestHandler: stsTransport(send),
        }),
    );
    await expect(verifier.organization(hub)).rejects.toThrow("AWS_UNKNOWN");
    expect(resolver).toHaveBeenCalledExactlyOnceWith(
      "sts.us-east-1.amazonaws.com",
    );
    expect(await send.mock.results[0]?.value).toMatchObject({
      ok: false,
      failure: { reason: "blocked_address" },
    });
  });

  it("does not start STS when the explicit provider stalls", async () => {
    const { factory } = fixture();
    const provider = vi.fn<Parameters<typeof createStsVerifier>[0]>(
      () => new Promise(() => {}),
    );
    await expect(
      createStsVerifier(provider, factory).organization(hub),
    ).rejects.toThrow("AWS_TIMEOUT");
    expect(provider.mock.calls[0]?.[0].aborted).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not disclose AWS error text or continue a failed chain", async () => {
    const { verifier, assumeRole, getCallerIdentity, destroy } = fixture();
    assumeRole.mockReset().mockRejectedValue(
      Object.assign(new Error("sensitive AWS details"), {
        name: "AccessDenied",
      }),
    );
    await expect(verifier.projectRole(hub, project)).rejects.toEqual(
      new StsError("AWS_ACCESS_DENIED"),
    );
    expect(assumeRole).toHaveBeenCalledTimes(1);
    expect(getCallerIdentity).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("stops even if credential resolution or transport does not finish", async () => {
    const { verifier, assumeRole, getCallerIdentity, destroy } = fixture();
    assumeRole.mockReset().mockImplementation(() => new Promise(() => {}));
    await expect(verifier.projectRole(hub, project)).rejects.toThrow(
      "AWS_TIMEOUT",
    );
    expect(assumeRole.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
    expect(assumeRole).toHaveBeenCalledTimes(1);
    expect(getCallerIdentity).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
