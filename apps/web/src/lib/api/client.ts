import { errorResponseSchema } from "@nightwatch/api-contract";
import type { ZodType } from "zod";

import { env } from "../env";

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

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
};

/**
 * Typed JSON request against the API. Always sends credentials so the
 * host-only session cookie travels with same-origin (or proxied) calls.
 * Pass `schema: undefined` for endpoints that answer 204 No Content.
 */
export async function request<T>(
  path: string,
  schema: ZodType<T> | undefined,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body } = options;

  let res: Response;
  try {
    res = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the API", 0);
  }

  if (res.status === 204) {
    if (schema === undefined) {
      return undefined as T;
    }
    throw new ApiError(
      "CONTRACT_MISMATCH",
      "API response did not match the contract",
      res.status,
    );
  }

  const bodyText: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(bodyText);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, message, res.status, details);
    }
    throw new ApiError(
      `HTTP_${res.status.toString()}`,
      `Request failed with status ${res.status.toString()}`,
      res.status,
    );
  }

  if (schema === undefined) {
    return undefined as T;
  }

  const parsed = schema.safeParse(bodyText);
  if (!parsed.success) {
    throw new ApiError(
      "CONTRACT_MISMATCH",
      "API response did not match the contract",
      res.status,
    );
  }
  return parsed.data;
}
