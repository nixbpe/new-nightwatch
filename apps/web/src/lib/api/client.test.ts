import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invitationResponseSchema,
  meContextResponseSchema,
  type MeContextResponse,
} from "@nightwatch/api-contract";
import { ApiError, request } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(response),
  );
}

/** The single fetch call openapi-fetch issued, as a Request instance. */
function issuedRequest(fetchMock: ReturnType<typeof vi.fn>): Request {
  expect(fetchMock).toHaveBeenCalledOnce();
  const [input] = fetchMock.mock.calls[0] as [Request];
  expect(input).toBeInstanceOf(Request);
  return input;
}

const meContextFixture: MeContextResponse = {
  user: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Ada",
    email: "ada@nightwatch.example",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [{ id: "550e8400-e29b-41d4-a716-446655440001", name: "Acme", slug: "acme", role: "owner" }],
  lastActiveTenantId: "550e8400-e29b-41d4-a716-446655440001",
};

describe("api request helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the contract-parsed response", async () => {
    stubFetch(jsonResponse(200, meContextFixture));
    await expect(request("/api/me/context", meContextResponseSchema)).resolves.toEqual(
      meContextFixture,
    );
  });

  it("sends credentials and JSON bodies for writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, meContextFixture));
    vi.stubGlobal("fetch", fetchMock);
    await request("/api/me/active-org", meContextResponseSchema, {
      method: "PATCH",
      body: { organizationId: "abc" },
    });
    const issued = issuedRequest(fetchMock);
    expect(new URL(issued.url).pathname).toBe("/api/me/active-org");
    expect(issued.method).toBe("PATCH");
    expect(issued.credentials).toBe("include");
    expect(issued.headers.get("content-type")).toBe("application/json");
    await expect(issued.text()).resolves.toBe(
      JSON.stringify({ organizationId: "abc" }),
    );
  });

  it("interpolates and encodes path template params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        invitation: {
          id: "550e8400-e29b-41d4-a716-446655440002",
          email: "invitee@nightwatch.example",
          organizationName: "Acme",
          role: "owner",
          expiresAt: new Date().toISOString(),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await request(
      "/api/onboarding/invitations/{invitationId}",
      invitationResponseSchema,
      { params: { invitationId: "a b/c" } },
    );
    const issued = issuedRequest(fetchMock);
    expect(new URL(issued.url).pathname).toBe(
      "/api/onboarding/invitations/a%20b%2Fc",
    );
  });

  it("resolves 204 No Content when no schema is expected", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(
      request("/api/me/context", undefined as never),
    ).resolves.toBeUndefined();
  });

  it("surfaces the server error envelope as ApiError", async () => {
    stubFetch(
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "not allowed" },
      }),
    );
    const failure = await request("/api/me/context", meContextResponseSchema).catch(
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
    stubFetch(jsonResponse(502, "<html>bad gateway</html>"));
    await expect(
      request("/api/me/context", meContextResponseSchema),
    ).rejects.toMatchObject({
      code: "HTTP_502",
      status: 502,
    });
  });

  it("rejects success payloads that violate the contract", async () => {
    stubFetch(jsonResponse(200, { unexpected: true }));
    await expect(
      request("/api/me/context", meContextResponseSchema),
    ).rejects.toMatchObject({
      code: "CONTRACT_MISMATCH",
    });
  });

  it("reports network failures distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(
      request("/api/me/context", meContextResponseSchema),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });
});
