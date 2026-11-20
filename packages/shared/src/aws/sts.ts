import {
  STS,
  type AssumeRoleCommandInput,
  type AssumeRoleCommandOutput,
  type Credentials,
  type GetCallerIdentityCommandInput,
  type GetCallerIdentityCommandOutput,
} from "@aws-sdk/client-sts";

import type { HttpRequest, HttpHandlerOptions } from "@smithy/types";
import { Readable } from "node:stream";

import { sendOutboundRequest } from "../outbound-http/send";

export const STS_DEFAULT_REGION = "us-east-1";
export const STS_REGIONS = [
  "af-south-1",
  "ap-east-1",
  "ap-east-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-6",
  "ap-southeast-7",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "mx-central-1",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
] as const;

const CALL_TIMEOUT_MS = 2_000;
const CHAIN_TIMEOUT_MS = 6_000;

export type StsErrorCode =
  "AWS_ACCESS_DENIED" | "AWS_REGION_DISABLED" | "AWS_TIMEOUT" | "AWS_UNKNOWN";

export class StsError extends Error {
  constructor(readonly code: StsErrorCode) {
    super(code);
    this.name = "StsError";
  }
}

type Role = { roleArn: string; externalId: string };
type Keys = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};
type Options = { abortSignal: AbortSignal };
type Client = {
  assumeRole(
    input: AssumeRoleCommandInput,
    options: Options,
  ): Promise<AssumeRoleCommandOutput>;
  getCallerIdentity(
    input: GetCallerIdentityCommandInput,
    options: Options,
  ): Promise<GetCallerIdentityCommandOutput>;
  destroy(): void;
};
type ClientFactory = (region: string, credentials: Keys) => Client;
type WorkloadCredentials = (
  signal: AbortSignal,
) => Promise<Keys & { sessionToken: string }>;

type Transport = STS["config"]["requestHandler"];

export function stsTransport(send = sendOutboundRequest): Transport {
  return {
    async handle(request: HttpRequest, options?: HttpHandlerOptions) {
      const { hostname, method, protocol, path } = request;
      if (
        protocol !== "https:" ||
        method !== "POST" ||
        path !== "/" ||
        request.port !== undefined ||
        request.username ||
        request.password ||
        Object.keys(request.query ?? {}).length > 0 ||
        !STS_REGIONS.some(
          (region) => hostname === `sts.${region}.amazonaws.com`,
        ) ||
        typeof request.body !== "string"
      )
        throw new StsError("AWS_UNKNOWN");
      const body = request.body;
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        const lower = name.toLowerCase();
        if (
          typeof value !== "string" ||
          (lower === "host" && value !== hostname) ||
          (lower === "content-length" &&
            value !== String(Buffer.byteLength(body)))
        ) {
          throw new StsError("AWS_UNKNOWN");
        }
        if (lower !== "host" && lower !== "content-length")
          headers[name] = value;
      }
      const signal = options?.abortSignal;
      const result = await send({
        url: `https://${hostname}/`,
        method,
        headers,
        body,
        timeoutMs: CALL_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyBytes: 65_536,
        secretHeaderNames: ["x-amz-security-token"],
        ...(signal instanceof AbortSignal && { signal }),
      });
      if (result.failure?.reason === "timeout")
        throw new StsError("AWS_TIMEOUT");
      if (!result.ok || !result.response || result.response.bodyTruncated) {
        throw new StsError("AWS_UNKNOWN");
      }
      const {
        status,
        headers: responseHeaders,
        body: responseBody,
      } = result.response;
      return {
        response: {
          statusCode: status,
          headers: responseHeaders,
          body: Readable.from([responseBody]),
        },
      };
    },
    destroy() {},
  };
}

function productionClient(region: string, credentials: Keys): Client {
  return new STS({
    region,
    endpoint: `https://sts.${region}.amazonaws.com`,
    ignoreConfiguredEndpointUrls: true,
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
    defaultsMode: "standard",
    retryMode: "standard",
    maxAttempts: 1,
    credentials,
    requestHandler: stsTransport(),
  });
}

function credentialsOf(value: Credentials | undefined): Keys {
  if (!value?.AccessKeyId || !value.SecretAccessKey || !value.SessionToken) {
    throw new StsError("AWS_UNKNOWN");
  }
  return {
    accessKeyId: value.AccessKeyId,
    secretAccessKey: value.SecretAccessKey,
    sessionToken: value.SessionToken,
  };
}

function errorCode(error: unknown, signal: AbortSignal): StsErrorCode {
  if (signal.aborted) return "AWS_TIMEOUT";
  if (error instanceof StsError) return error.code;
  if (error instanceof Error) {
    switch (error.name) {
      case "AccessDenied":
      case "AccessDeniedException":
      case "InvalidClientTokenId":
      case "SignatureDoesNotMatch":
        return "AWS_ACCESS_DENIED";
      case "RegionDisabledException":
      case "RegionDisabled":
        return "AWS_REGION_DISABLED";
      case "TimeoutError":
        return "AWS_TIMEOUT";
    }
  }
  return "AWS_UNKNOWN";
}

async function call<T>(
  deadline: AbortSignal,
  send: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.any([
    deadline,
    AbortSignal.timeout(CALL_TIMEOUT_MS),
  ]);
  let onAbort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(new StsError("AWS_TIMEOUT"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const result = await Promise.race([abort, send(signal)]);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    throw new StsError(errorCode(error, signal));
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function createStsVerifier(
  workloadCredentials: WorkloadCredentials,
  makeClient: ClientFactory = productionClient,
) {
  async function withClient<T>(
    region: string,
    credentials: Keys,
    operation: (client: Client) => Promise<T>,
  ) {
    if (!STS_REGIONS.some((allowed) => allowed === region)) {
      throw new StsError("AWS_REGION_DISABLED");
    }
    const client = makeClient(region, credentials);
    try {
      return await operation(client);
    } finally {
      client.destroy();
    }
  }

  async function assume(role: Role, deadline: AbortSignal, credentials: Keys) {
    return withClient(STS_DEFAULT_REGION, credentials, async (client) => {
      const response = await call(deadline, (abortSignal) =>
        client.assumeRole(
          {
            RoleArn: role.roleArn,
            ExternalId: role.externalId,
            RoleSessionName: "NightWatchConnectionTest",
            DurationSeconds: 900,
          },
          { abortSignal },
        ),
      );
      return credentialsOf(response.Credentials);
    });
  }

  async function identity(region: string, keys: Keys, deadline: AbortSignal) {
    return withClient(region, keys, async (client) => {
      const result = await call(deadline, (abortSignal) =>
        client.getCallerIdentity({}, { abortSignal }),
      );
      if (!result.Account || !result.Arn) throw new StsError("AWS_UNKNOWN");
      return { accountId: result.Account, arn: result.Arn };
    });
  }

  return {
    async organization(role: Role) {
      const deadline = AbortSignal.timeout(CHAIN_TIMEOUT_MS);
      return identity(
        STS_DEFAULT_REGION,
        await assume(role, deadline, await call(deadline, workloadCredentials)),
        deadline,
      );
    },
    async projectRole(hub: Role, project: Role) {
      const deadline = AbortSignal.timeout(CHAIN_TIMEOUT_MS);
      const hubCredentials = await assume(
        hub,
        deadline,
        await call(deadline, workloadCredentials),
      );
      return identity(
        STS_DEFAULT_REGION,
        await assume(project, deadline, hubCredentials),
        deadline,
      );
    },
    accessKey(region: string, keys: Omit<Keys, "sessionToken">) {
      return identity(region, keys, AbortSignal.timeout(CHAIN_TIMEOUT_MS));
    },
  };
}

export type StsVerifier = ReturnType<typeof createStsVerifier>;
