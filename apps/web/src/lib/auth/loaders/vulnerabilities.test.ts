import type { MeContextResponse } from "@nightwatch/api-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardUnassignedNetwork } from "../../../test/guard-network";
import { fetchMeContext } from "../../api/me";
import {
  fetchNewVulnerabilities,
  fetchPriority,
  fetchVulnerabilities,
} from "../../api/vulnerabilities";
import {
  peekStagedQueryClient,
  resetQueryClientRegistry,
} from "../../queryClient";
import { vulnerabilitiesLoader } from "./vulnerabilities";

guardUnassignedNetwork();

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ getSession: getSessionMock }),
}));
vi.mock("../../api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
}));
vi.mock("../../api/vulnerabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVulnerabilities: vi.fn(),
  fetchPriority: vi.fn(),
  fetchNewVulnerabilities: vi.fn(),
}));

const listMock = vi.mocked(fetchVulnerabilities);
const priorityMock = vi.mocked(fetchPriority);
const freshMock = vi.mocked(fetchNewVulnerabilities);

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

function load(search: string) {
  const url = new URL(
    `http://localhost/organizations/${ORG}/projects/${PROJECT}/vulnerabilities${search}`,
  );
  return vulnerabilitiesLoader({
    request: new Request(url),
    url,
    pattern:
      "/organizations/:organizationId/projects/:projectId/vulnerabilities",
    params: { organizationId: ORG, projectId: PROJECT },
    context: {},
  });
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({
    data: { user: { id: "user-a", emailVerified: true } },
    error: null,
  });
  vi.mocked(fetchMeContext).mockResolvedValue(owner);
  listMock.mockResolvedValue(
    {} as Awaited<ReturnType<typeof fetchVulnerabilities>>,
  );
  priorityMock.mockResolvedValue(
    {} as Awaited<ReturnType<typeof fetchPriority>>,
  );
  freshMock.mockResolvedValue(
    {} as Awaited<ReturnType<typeof fetchNewVulnerabilities>>,
  );
});

afterEach(async () => {
  const client = peekStagedQueryClient()?.client;
  await client?.cancelQueries();
  client?.clear();
  resetQueryClientRegistry();
  vi.resetAllMocks();
});

describe("vulnerabilitiesLoader", () => {
  it("prefetches the list, the ranking and the new-CVE list for the Needs-fix view", async () => {
    await load("?new=1");
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(priorityMock).toHaveBeenCalledTimes(1);
    expect(freshMock).toHaveBeenCalledTimes(1);
  });

  it("prefetches only the list for the By-System view", async () => {
    await load("?view=systems");
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(priorityMock).not.toHaveBeenCalled();
    expect(freshMock).not.toHaveBeenCalled();
  });
});
