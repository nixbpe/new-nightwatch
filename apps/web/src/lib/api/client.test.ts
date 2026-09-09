import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, request } from "./client";

const payloadSchema = z.object({ ok: z.boolean() });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api request helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the contract-parsed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })),
    );
    await expect(request("/api/v1/x", payloadSchema)).resolves.toEqual({
      ok: true,
    });
  });

  it("sends credentials and JSON bodies for writes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await request("/api/me/active-org", payloadSchema, {
      method: "PATCH",
      body: { organizationId: "abc" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: "abc" }),
      }),
    );
  });

  it("resolves 204 No Content when no schema is expected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(request("/api/v1/x", undefined)).resolves.toBeUndefined();
  });

  it("surfaces the server error envelope as ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: { code: "FORBIDDEN", message: "not allowed" },
        }),
      ),
    );
    const failure = await request("/api/v1/x", payloadSchema).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: "FORBIDDEN",
      message: "not allowed",
      status: 403,
    });
  });

  it("maps non-envelope failures to an HTTP status error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(502, "<html>bad gateway</html>")),
    );
    await expect(request("/api/v1/x", payloadSchema)).rejects.toMatchObject({
      code: "HTTP_502",
      status: 502,
    });
  });

  it("rejects success payloads that violate the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })),
    );
    await expect(request("/api/v1/x", payloadSchema)).rejects.toMatchObject({
      code: "CONTRACT_MISMATCH",
    });
  });

  it("reports network failures distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(request("/api/v1/x", payloadSchema)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });
});
