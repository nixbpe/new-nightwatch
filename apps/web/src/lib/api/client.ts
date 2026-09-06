import {
  errorResponseSchema,
  helloResponseSchema,
  type HelloResponse,
} from "@nightwatch/api-contract";
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

async function request<T>(path: string, schema: ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.VITE_API_BASE_URL}${path}`);
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the API", 0);
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(body);
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "CONTRACT_MISMATCH",
      "API response did not match the contract",
      res.status,
    );
  }
  return parsed.data;
}

export function fetchHello(): Promise<HelloResponse> {
  return request("/api/v1/hello", helloResponseSchema);
}
