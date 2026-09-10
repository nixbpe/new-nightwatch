import { errorResponseSchema } from "@nightwatch/api-contract";
import createClient from "openapi-fetch";
import type { ZodType } from "zod";

import { env } from "../env";
import type { paths } from "./openapi-types.gen";

/** Client-side API failure; mirrors the api-contract error envelope. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** HTTP verbs the OpenAPI document can declare. */
export type RequestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Contract paths that declare the given verb (undeclared verbs are `?: never`). */
type PathsFor<M extends RequestMethod> = {
  [P in keyof paths]: Lowercase<M> extends keyof paths[P]
    ? [paths[P][Lowercase<M>]] extends [undefined]
      ? never
      : P
    : never;
}[keyof paths];

/** Operation object for a declared path+verb pair; never when undeclared. */
type OperationFor<P extends keyof paths, M extends RequestMethod> =
  Lowercase<M> extends keyof paths[P]
    ? Exclude<paths[P][Lowercase<M>], undefined>
    : never;

/** Declared path-template parameters; never when the operation takes none. */
type PathParamsFor<P extends keyof paths, M extends RequestMethod> =
  OperationFor<P, M> extends { parameters?: infer TParameters }
    ? TParameters extends { path: infer TPathParams }
      ? TPathParams
      : never
    : never;

/** Declared JSON request body; never when the operation takes none. */
type RequestBodyFor<P extends keyof paths, M extends RequestMethod> =
  OperationFor<P, M> extends { requestBody?: infer TRequestBody }
    ? TRequestBody extends { content: { "application/json": infer TBody } }
      ? TBody
      : never
    : never;

/** Successful operation JSON payload from 2xx responses; never if no content is defined. */
type OperationSuccessPayload<
  TOperation,
> = TOperation extends { responses: infer TResponses }
  ? {
      [K in keyof TResponses]: K extends string | number
        ? `${K}` extends `2${string}`
          ? TResponses[K] extends {
              content: { "application/json": infer TPayload }
            }
            ? TPayload
            : never
          : never
        : never;
    }[keyof TResponses]
  : never;

type OperationSuccessSchema<
  P extends keyof paths,
  M extends RequestMethod,
> = [OperationSuccessPayload<OperationFor<P, M>>] extends [never]
  ? undefined
  : ZodType<OperationSuccessPayload<OperationFor<P, M>>>;

type OperationReturn<P extends keyof paths, M extends RequestMethod> =
  OperationSuccessPayload<OperationFor<P, M>>;

export type RequestOptions<
  P extends keyof paths,
  M extends RequestMethod = "GET",
> = {
  method?: M;
} & ([PathParamsFor<P, M>] extends [never]
  ? { params?: never }
  : { params: PathParamsFor<P, M> }) &
  ([RequestBodyFor<P, M>] extends [never]
    ? { body?: never }
    : { body: RequestBodyFor<P, M> });

const client = createClient<paths>({
  baseUrl: env.VITE_API_BASE_URL,
  credentials: "include",
  // Resolve fetch per call: capturing the global here would freeze it
  // before test doubles or polyfills can replace it.
  fetch: (...args) => globalThis.fetch(...args),
});

type ClientOutcome = {
  data: unknown;
  error: unknown;
  response: Response;
};

/**
 * Typed JSON request against the API. Path, verb, path params and body
 * are checked against the generated OpenAPI types at compile time; the
 * zod schema still validates the response at runtime. Always sends
 * credentials so the host-only session cookie travels with same-origin
 * (or proxied) calls. Pass `schema: undefined` for endpoints that answer
 * 204 No Content.
 */
export async function request<
  M extends RequestMethod = "GET",
  P extends PathsFor<M> = PathsFor<M>,
>(
  path: P,
  schema: OperationSuccessSchema<P, M>,
  options?: RequestOptions<P, M>,
): Promise<OperationReturn<P, M> extends never ? undefined : OperationReturn<P, M>> {
  const method: RequestMethod = options?.method ?? "GET";

  const call = client[method] as unknown as (
    url: string,
    init: {
      params?: { path: Record<string, string> };
      body?: unknown;
      parseAs: "text";
    },
  ) => Promise<ClientOutcome>;

  const { params, body: requestBody } = (options ?? {}) as {
    params?: Record<string, string>;
    body?: unknown;
  };

  let outcome: ClientOutcome;
  try {
    outcome = await call(path, {
      params: params === undefined ? undefined : { path: params },
      body: requestBody,
      // Raw text keeps JSON parsing here, preserving the previous layer's
      // `res.json().catch(() => null)` failure semantics.
      parseAs: "text",
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the API", 0);
  }

  const { data, error, response } = outcome;

  if (response.status === 204) {
    if (schema === undefined) {
      return undefined;
    }
    throw new ApiError(
      "CONTRACT_MISMATCH",
      "API response did not match the contract",
      response.status,
    );
  }

  if (!response.ok) {
    // openapi-fetch yields the parsed envelope for JSON error bodies and
    // raw text otherwise; both fail envelope parsing exactly like the
    // previous layer's null-on-parse-failure did.
    const parsed = errorResponseSchema.safeParse(error ?? null);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, message, response.status, details);
    }
    throw new ApiError(
      `HTTP_${response.status.toString()}`,
      `Request failed with status ${response.status.toString()}`,
      response.status,
    );
  }

  if (schema === undefined) {
    return undefined;
  }

  let bodyText: unknown = data;
  if (typeof data === "string") {
    try {
      bodyText = JSON.parse(data) as unknown;
    } catch {
      bodyText = null;
    }
  }

  const parsed = schema.safeParse(bodyText);
  if (!parsed.success) {
    throw new ApiError(
      "CONTRACT_MISMATCH",
      "API response did not match the contract",
      response.status,
    );
  }
  return parsed.data;
}
