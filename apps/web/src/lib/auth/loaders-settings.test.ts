import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardUnassignedNetwork } from "../../test/guard-network";
import {
  peekStagedQueryClient,
  publishActiveQueryClient,
  resetQueryClientRegistry,
  resolveQueryClientForIdentity,
} from "../queryClient";
import type { SessionRow } from "../sessions/sessions";
import { sessionsLoader } from "./loaders";

guardUnassignedNetwork();

const { getSessionMock, listSessionsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<
    () => Promise<{
      data: { user: { id: string; emailVerified: boolean } } | null;
      error: null;
    }>
  >(),
  listSessionsMock: vi.fn<() => Promise<{ data: SessionRow[]; error: null }>>(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    getSession: getSessionMock,
    listSessions: listSessionsMock,
  }),
}));

const session: SessionRow = {
  id: "session-a",
  token: "token-a",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  expiresAt: new Date("2026-11-01T00:00:00Z"),
  ipAddress: "203.0.113.8",
  userAgent: "unit-test",
};

beforeEach(() => {
  getSessionMock.mockResolvedValue({ data: null, error: null });
  listSessionsMock.mockResolvedValue({ data: [session], error: null });
});

afterEach(async () => {
  const client = peekStagedQueryClient()?.client;
  await client?.cancelQueries();
  client?.clear();
  resetQueryClientRegistry();
  vi.resetAllMocks();
});

describe("sessionsLoader", () => {
  it.each([null, { user: { id: "user-a", emailVerified: false } }])(
    "leaves the parent gate to redirect an ineligible session %j",
    async (data) => {
      getSessionMock.mockResolvedValue({ data, error: null });

      expect(await sessionsLoader()).toBeNull();
      expect(listSessionsMock).not.toHaveBeenCalled();
      expect(peekStagedQueryClient()).toBeNull();
    },
  );

  it("prefetches personal sessions into the verified identity without overwriting another identity", async () => {
    const other = resolveQueryClientForIdentity("user-b");
    publishActiveQueryClient("user-b", other);
    other.setQueryData(["me", "sessions"], [{ id: "session-b" }]);
    getSessionMock.mockResolvedValue({
      data: { user: { id: "user-a", emailVerified: true } },
      error: null,
    });

    try {
      expect(await sessionsLoader()).toBeNull();
      const staged = peekStagedQueryClient();
      expect(staged?.identity).toBe("user-a");
      expect(staged?.client.getQueryData(["me", "sessions"])).toEqual([
        {
          id: "session-a",
          token: "token-a",
          createdAt: new Date("2026-10-01T00:00:00Z"),
          updatedAt: new Date("2026-10-02T00:00:00Z"),
          expiresAt: new Date("2026-11-01T00:00:00Z"),
          ipAddress: "203.0.113.8",
          userAgent: "unit-test",
        },
      ]);
      expect(other.getQueryData(["me", "sessions"])).toEqual([
        { id: "session-b" },
      ]);
    } finally {
      await other.cancelQueries();
      other.clear();
    }
  });

  it("returns null for a failed sessions prefetch and leaves the query error for the page", async () => {
    getSessionMock.mockResolvedValue({
      data: { user: { id: "user-a", emailVerified: true } },
      error: null,
    });
    listSessionsMock.mockRejectedValue(new Error("sessions unavailable"));

    expect(await sessionsLoader()).toBeNull();
    const staged = peekStagedQueryClient();
    expect(staged?.identity).toBe("user-a");
    expect(staged?.client.getQueryState(["me", "sessions"])?.status).toBe(
      "error",
    );
    expect(staged?.client.getQueryData(["me", "sessions"])).toBeUndefined();
  });
});
