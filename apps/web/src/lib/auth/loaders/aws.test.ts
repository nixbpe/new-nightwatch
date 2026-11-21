import type { MeContextResponse } from "@nightwatch/api-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardUnassignedNetwork } from "../../../test/guard-network";
import { fetchOrganizationAws } from "../../api/aws";
import { ApiError } from "../../api/client";
import { fetchMeContext } from "../../api/me";
import {
  peekStagedQueryClient,
  resetQueryClientRegistry,
} from "../../queryClient";
import { awsLoader } from "./aws";

guardUnassignedNetwork();

const ORG = "11111111-1111-4111-8111-111111111111";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ getSession: getSessionMock }),
}));
vi.mock("../../api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
}));
vi.mock("../../api/aws", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationAws: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchMock = vi.mocked(fetchOrganizationAws);

const owner: MeContextResponse = {
  user: {
    id: "user-a",
    name: "Owner",
    email: "owner@nightwatch.invalid",
    emailVerified: true,
    twoFactorEnabled: false,
  },
  organizations: [{ id: ORG, name: "Org", slug: "org", role: "owner" }],
  lastActiveTenantId: ORG,
};

function load() {
  const url = new URL(`http://localhost/organizations/${ORG}/aws`);
  return awsLoader({
    request: new Request(url),
    url,
    pattern: "/organizations/:organizationId/aws",
    params: { organizationId: ORG },
    context: {},
  });
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({
    data: { user: { id: "user-a", emailVerified: true } },
    error: null,
  });
  fetchMeContextMock.mockResolvedValue(owner);
});

afterEach(async () => {
  const client = peekStagedQueryClient()?.client;
  await client?.cancelQueries();
  client?.clear();
  resetQueryClientRegistry();
  vi.resetAllMocks();
});

describe("awsLoader", () => {
  it.each(["PERMISSION_DENIED", "MEMBERSHIP_DENIED"] as const)(
    "F-013 AC-08 D5 loads the context again when the Organization prefetch answers %s",
    async (code) => {
      fetchMock.mockRejectedValue(new ApiError(code, "denied", 403));
      expect(await load()).toBeNull();
      expect(fetchMeContextMock).toHaveBeenCalledTimes(2);
    },
  );

  it("F-013 D5 keeps the context on a prefetch failure other than a denial", async () => {
    fetchMock.mockRejectedValue(new ApiError("HTTP_500", "boom", 500));
    expect(await load()).toBeNull();
    expect(fetchMeContextMock).toHaveBeenCalledTimes(1);
  });
});
