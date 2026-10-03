import { errorResponseSchema } from "@nightwatch/api-contract";
import createClient from "openapi-fetch";
import type { ZodType } from "zod";

import { env } from "../env";
import type { paths } from "./openapi-types.gen";

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

export type RequestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

// Undeclared verbs appear as `?: never`, hence the undefined check.
type PathsFor<M extends RequestMethod> = {
  [P in keyof paths]: Lowercase<M> extends keyof paths[P]
    ? [paths[P][Lowercase<M>]] extends [undefined]
      ? never
      : P
    : never;
}[keyof paths];

type OperationFor<P extends keyof paths, M extends RequestMethod> =
  Lowercase<M> extends keyof paths[P]
    ? Exclude<paths[P][Lowercase<M>], undefined>
    : never;

type PathParamsFor<P extends keyof paths, M extends RequestMethod> =
  OperationFor<P, M> extends { parameters?: infer TParameters }
    ? TParameters extends { path: infer TPathParams }
      ? TPathParams
      : never
    : never;

type QueryParamsFor<P extends keyof paths, M extends RequestMethod> =
  OperationFor<P, M> extends { parameters?: infer TParameters }
    ? TParameters extends { query?: infer TQuery }
      ? TQuery
      : never
    : never;

type RequestBodyFor<P extends keyof paths, M extends RequestMethod> =
  OperationFor<P, M> extends { requestBody?: infer TRequestBody }
    ? TRequestBody extends { content: { "application/json": infer TBody } }
      ? TBody
      : never
    : never;

type OperationSuccessPayload<TOperation> = TOperation extends {
  responses: infer TResponses;
}
  ? {
      [K in keyof TResponses]: K extends string | number
        ? `${K}` extends `2${string}`
          ? TResponses[K] extends {
              content: { "application/json": infer TPayload };
            }
            ? TPayload
            : never
          : never
        : never;
    }[keyof TResponses]
  : never;

type OperationSuccessSchema<P extends keyof paths, M extends RequestMethod> = [
  OperationSuccessPayload<OperationFor<P, M>>,
] extends [never]
  ? undefined
  : ZodType<OperationSuccessPayload<OperationFor<P, M>>>;

type OperationReturn<
  P extends keyof paths,
  M extends RequestMethod,
> = OperationSuccessPayload<OperationFor<P, M>>;

export type RequestOptions<
  P extends keyof paths,
  M extends RequestMethod = "GET",
> = {
  method?: M;
  /** Aborting surfaces as a `NETWORK_ERROR` like any failed fetch. */
  signal?: AbortSignal;
} & ([QueryParamsFor<P, M>] extends [never]
  ? { query?: never }
  : { query?: QueryParamsFor<P, M> }) &
  ([PathParamsFor<P, M>] extends [never]
    ? { params?: never }
    : { params: PathParamsFor<P, M> }) &
  ([RequestBodyFor<P, M>] extends [never]
    ? { body?: never }
    : { body: RequestBodyFor<P, M> });

const client = createClient<paths>({
  baseUrl: env.VITE_API_BASE_URL,
  credentials: "include",
  // Resolve fetch per call: capturing the global would freeze it before test doubles replace it.
  fetch: (...args) => globalThis.fetch(...args),
});

type ClientOutcome = {
  data: unknown;
  error: unknown;
  response: Response;
};

// Pass `schema: undefined` for endpoints that answer 204 No Content.
export async function request<
  M extends RequestMethod = "GET",
  P extends PathsFor<M> = PathsFor<M>,
>(
  path: P,
  schema: OperationSuccessSchema<P, M>,
  options?: RequestOptions<P, M>,
): Promise<
  OperationReturn<P, M> extends never ? undefined : OperationReturn<P, M>
> {
  const method: RequestMethod = options?.method ?? "GET";

  const call = client[method] as unknown as (
    url: string,
    init: {
      params?: {
        path?: Record<string, string>;
        query?: Record<string, unknown>;
      };
      body?: unknown;
      parseAs: "text";
      signal?: AbortSignal;
    },
  ) => Promise<ClientOutcome>;

  const {
    params,
    query,
    body: requestBody,
  } = (options ?? {}) as {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  };

  let outcome: ClientOutcome;
  try {
    outcome = await call(path, {
      params:
        params === undefined && query === undefined
          ? undefined
          : {
              ...(params === undefined ? {} : { path: params }),
              ...(query === undefined ? {} : { query }),
            },
      body: requestBody,
      // Raw text so an unparsable body becomes null instead of throwing.
      parseAs: "text",
      signal: options?.signal,
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

type FileOperation<P extends keyof paths> = Exclude<
  paths[P]["get" & keyof paths[P]],
  undefined
>;

// Only GET paths whose success body is a file (`text/csv`) qualify.
type FilePaths = {
  [P in keyof paths]: FileOperation<P> extends {
    responses: { 200: { content: { "text/csv": string } } };
  }
    ? P
    : never;
}[keyof paths];

export type DownloadedFile = { blob: Blob; filename: string | null };

function filenameOf(disposition: string | null): string | null {
  if (disposition === null) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
}

/** A file body as the untouched Blob plus the name from `Content-Disposition`; errors use the JSON envelope like `request`. */
export async function requestFile<P extends FilePaths>(
  path: P,
  options: {
    params: PathParamsFor<P, "GET">;
    signal?: AbortSignal;
  },
): Promise<DownloadedFile> {
  const call = client.GET as unknown as (
    url: string,
    init: {
      params: { path: Record<string, string> };
      parseAs: "blob";
      signal?: AbortSignal;
    },
  ) => Promise<ClientOutcome>;
  let outcome: ClientOutcome;
  try {
    outcome = await call(path, {
      params: { path: options.params },
      parseAs: "blob",
      signal: options.signal,
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the API", 0);
  }
  const { data, error, response } = outcome;
  if (!response.ok) {
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
  // The Blob goes through untouched: reading the body as text would drop a UTF-8 BOM, and
  // Excel needs it to open the CSV as UTF-8.
  return {
    blob: data instanceof Blob ? data : new Blob([]),
    filename: filenameOf(response.headers.get("Content-Disposition")),
  };
}
