import {
  errorResponseSchema,
  helloResponseSchema,
  readinessResponseSchema,
  versionResponseSchema,
} from "@nightwatch/api-contract";
import { AppError, createLogger, type Env } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { createApp } from "./app";

const env: Env = { PORT: 4000, LOG_LEVEL: "silent", NODE_ENV: "test" };

function makeApp() {
  const app = createApp({
    env,
    logger: createLogger({ level: "silent", name: "test" }),
  });
  // Test-only probes exercising the centralized error handler.
  app.get("/__test/app-error", () => {
    throw new AppError("HELLO_FORBIDDEN", "greeting is not allowed", 403, {
      reason: "test",
    });
  });
  app.get("/__test/boom", () => {
    throw new Error("connection string postgres://user:sekret@db:5432 leaked");
  });
  return app;
}

describe("GET /api/v1/hello", () => {
  it("responds 200 with the contract shape and a request id", async () => {
    const res = await makeApp().request("/api/v1/hello");
    expect(res.status).toBe(200);
    expect(helloResponseSchema.parse(await res.json())).toEqual({
      message: "Hello from NightWatch",
      timestamp: expect.any(String) as string,
    });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("system endpoints", () => {
  it("GET /health reports liveness", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready reports readiness with named checks", async () => {
    const res = await makeApp().request("/ready");
    expect(res.status).toBe(200);
    expect(readinessResponseSchema.parse(await res.json())).toEqual({
      status: "ready",
      checks: { self: "ok" },
    });
  });

  it("GET /version reports package identity", async () => {
    const res = await makeApp().request("/version");
    expect(res.status).toBe(200);
    expect(versionResponseSchema.parse(await res.json())).toEqual({
      name: "@nightwatch/api",
      version: "0.0.1",
    });
  });
});

describe("error contract", () => {
  it("maps AppError to its code, message, details and status", async () => {
    const res = await makeApp().request("/__test/app-error");
    expect(res.status).toBe(403);
    expect(errorResponseSchema.parse(await res.json())).toEqual({
      error: {
        code: "HELLO_FORBIDDEN",
        message: "greeting is not allowed",
        details: { reason: "test" },
      },
    });
  });

  it("maps unknown errors to a generic 500 without leaking internals", async () => {
    const res = await makeApp().request("/__test/boom");
    expect(res.status).toBe(500);
    const body = errorResponseSchema.parse(await res.json());
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("returns the error envelope for unknown routes", async () => {
    const res = await makeApp().request("/no-such-route");
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("OpenAPI", () => {
  it("serves the spec containing the hello route", async () => {
    const res = await makeApp().request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths).toHaveProperty("/api/v1/hello");
    expect(spec.paths).toHaveProperty("/health");
    expect(spec.paths).toHaveProperty("/ready");
    expect(spec.paths).toHaveProperty("/version");
  });
});
