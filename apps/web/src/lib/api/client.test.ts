import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invitationResponseSchema,
  inventorySummarySchema,
  meContextResponseSchema,
  type MeContextResponse,
} from "@nightwatch/api-contract";
import { ApiError, request, requestFile, requestUpload } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

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
  organizations: [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      name: "Acme",
      slug: "acme",
      role: "owner",
    },
  ],
  lastActiveTenantId: "550e8400-e29b-41d4-a716-446655440001",
};

describe("api request helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the contract-parsed response", async () => {
    stubFetch(jsonResponse(200, meContextFixture));
    await expect(
      request("/api/me/context", meContextResponseSchema),
    ).resolves.toEqual(meContextFixture);
  });

  it("sends credentials and JSON bodies for writes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, meContextFixture));
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

  it("rejects 204 when a success contract is expected", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(
      request("/api/me/context", meContextResponseSchema),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "CONTRACT_MISMATCH",
      message: "API response did not match the contract",
      status: 204,
    });
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
    const failure = await request(
      "/api/me/context",
      meContextResponseSchema,
    ).catch((error: unknown) => error);
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

describe.each([
  [
    "request",
    (signal?: AbortSignal) =>
      request("/api/me/context", meContextResponseSchema, { signal }),
  ],
  [
    "requestUpload",
    (signal?: AbortSignal) =>
      requestUpload(
        "/api/organizations/{organizationId}/projects/{projectId}/inventory",
        inventorySummarySchema,
        {
          params: { organizationId: "org-1", projectId: "project-1" },
          file: new File(["System"], "inventory.csv"),
          signal,
        },
      ),
  ],
  [
    "requestFile",
    (signal?: AbortSignal) =>
      requestFile(
        "/api/organizations/{organizationId}/audit-log/exports/{exportId}/download",
        { params: { organizationId: "org-1", exportId: "exp-1" }, signal },
      ),
  ],
] as const)("%s error boundary", (_name, call) => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves ApiError identity, server message and nested details", async () => {
    stubFetch(
      jsonResponse(422, {
        error: {
          code: "VALIDATION_ERROR",
          message: "invalid fields",
          details: { fields: [{ path: "email", message: "invalid email" }] },
        },
      }),
    );
    const failure: unknown = await call().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      name: "ApiError",
      code: "VALIDATION_ERROR",
      message: "invalid fields",
      status: 422,
      details: { fields: [{ path: "email", message: "invalid email" }] },
    });
  });

  it.each([
    null,
    { error: { code: "BAD" } },
    { error: { code: 12, message: "bad" } },
  ])("uses the HTTP fallback for invalid envelope %j", async (body) => {
    stubFetch(jsonResponse(503, body));
    const failure: unknown = await call().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: "HTTP_503",
      message: "Request failed with status 503",
      status: 503,
      details: undefined,
    });
  });

  it("uses the HTTP fallback for a non-JSON response", async () => {
    stubFetch(new Response("<html>unavailable</html>", { status: 502 }));
    await expect(call()).rejects.toMatchObject({
      code: "HTTP_502",
      message: "Request failed with status 502",
      status: 502,
    });
  });

  it("forwards abort and maps it to NETWORK_ERROR", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    controller.abort();
    await expect(call(controller.signal)).rejects.toMatchObject({
      name: "ApiError",
      code: "NETWORK_ERROR",
      message: "Could not reach the API",
      status: 0,
    });
    expect(issuedRequest(fetchMock).signal.aborted).toBe(true);
  });
});

describe("requestFile", () => {
  const path =
    "/api/organizations/{organizationId}/audit-log/exports/{exportId}/download" as const;
  const params = { organizationId: "org-1", exportId: "exp-1" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the body as a typed Blob with the name from Content-Disposition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("time,actor\n", {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="nightwatch-audit-log-2026-10-03.csv"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = await requestFile(path, { params });
    expect(file.filename).toBe("nightwatch-audit-log-2026-10-03.csv");
    expect(file.blob.type).toBe("text/csv; charset=utf-8");
    await expect(file.blob.text()).resolves.toBe("time,actor\n");
    const request = issuedRequest(fetchMock);
    expect(request.url).toContain("/audit-log/exports/exp-1/download");
    expect(request.credentials).toBe("include");
  });

  it("keeps the UTF-8 BOM of a CSV byte for byte (Excel needs it)", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x74, 0x69, 0x6d, 0x65]);
    stubFetch(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8" },
      }),
    );
    const file = await requestFile(path, { params });
    const received = new Uint8Array(await file.blob.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(bytes));
    expect(file.blob.type).toContain("text/csv");
  });

  it("prefers the UTF-8 filename and has none without the header", async () => {
    stubFetch(
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-disposition": "attachment; filename*=UTF-8''%E0%B8%81.json",
        },
      }),
    );
    await expect(requestFile(path, { params })).resolves.toMatchObject({
      filename: "ก.json",
    });
    stubFetch(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await expect(requestFile(path, { params })).resolves.toMatchObject({
      filename: null,
    });
  });

  it.each([
    [404, "AUDIT_EXPORT_NOT_FOUND"],
    [409, "AUDIT_EXPORT_NOT_READY"],
    [410, "AUDIT_EXPORT_EXPIRED"],
    [403, "PERMISSION_DENIED"],
  ])("maps a %i JSON envelope to an ApiError", async (status, code) => {
    stubFetch(jsonResponse(status, { error: { code, message: "m" } }));
    await expect(requestFile(path, { params })).rejects.toMatchObject({
      name: "ApiError",
      code,
      status,
    });
  });

  it("reports a network failure as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(requestFile(path, { params })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });
});

describe("requestUpload", () => {
  const path =
    "/api/organizations/{organizationId}/projects/{projectId}/inventory" as const;
  const params = { organizationId: "org-1", projectId: "project-1" };
  const summary = {
    canUpload: true,
    mappings: { pending: 0, confirmed: 0, unmapped: 0 },
    systemCount: 0,
    totalRows: 0,
    usableRows: 0,
    lastUploadAt: null,
    lastUploadFileName: null,
    systems: [],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the file as multipart field `file` with the boundary left to the browser", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, summary));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["System,Owner"], "inventory.csv", {
      type: "text/csv",
    });

    const result = await requestUpload(path, inventorySummarySchema, {
      params,
      file,
    });

    expect(result).toEqual(summary);
    const sent = issuedRequest(fetchMock);
    expect(sent.method).toBe("POST");
    expect(new URL(sent.url).pathname).toBe(
      "/api/organizations/org-1/projects/project-1/inventory",
    );
    expect(sent.headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    const form = await sent.formData();
    const sentFile = form.get("file");
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).name).toBe("inventory.csv");
    await expect((sentFile as File).text()).resolves.toBe("System,Owner");
  });

  it("rejects a reply that does not match the contract", async () => {
    stubFetch(jsonResponse(200, { systemCount: "many" }));
    const failure: unknown = await requestUpload(path, inventorySummarySchema, {
      params,
      file: new File(["x"], "inventory.csv"),
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "CONTRACT_MISMATCH",
      status: 200,
    });
  });
});
