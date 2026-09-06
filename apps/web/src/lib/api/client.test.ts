import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, fetchHello } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const helloBody = {
  message: "Hello from NightWatch",
  timestamp: "2026-09-06T12:00:00.000Z",
};

describe("fetchHello", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the contract-parsed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, helloBody)),
    );
    await expect(fetchHello()).resolves.toEqual(helloBody);
  });

  it("surfaces the server error envelope as ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: { code: "HELLO_FORBIDDEN", message: "not allowed" },
        }),
      ),
    );
    const failure = await fetchHello().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: "HELLO_FORBIDDEN",
      message: "not allowed",
      status: 403,
    });
  });

  it("maps non-envelope failures to an HTTP status error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(502, "<html>bad gateway</html>")),
    );
    await expect(fetchHello()).rejects.toMatchObject({
      code: "HTTP_502",
      status: 502,
    });
  });

  it("rejects success payloads that violate the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })),
    );
    await expect(fetchHello()).rejects.toMatchObject({
      code: "CONTRACT_MISMATCH",
    });
  });

  it("reports network failures distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(fetchHello()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });
});
