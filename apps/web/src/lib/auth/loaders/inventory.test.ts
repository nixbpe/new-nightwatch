import type { MeContextResponse } from "@nightwatch/api-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardUnassignedNetwork } from "../../../test/guard-network";
import {
  fetchImportPreview,
  fetchInventory,
  fetchRows,
} from "../../api/inventory";
import { fetchMeContext } from "../../api/me";
import {
  peekStagedQueryClient,
  resetQueryClientRegistry,
} from "../../queryClient";
import { inventoryImportLoader, inventoryLoader } from "./inventory";

guardUnassignedNetwork();

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SYSTEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ getSession: getSessionMock }),
}));
vi.mock("../../api/me", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMeContext: vi.fn(),
}));
vi.mock("../../api/inventory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInventory: vi.fn(),
  fetchRows: vi.fn(),
  fetchImportPreview: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const summaryMock = vi.mocked(fetchInventory);
const rowsMock = vi.mocked(fetchRows);
const previewMock = vi.mocked(fetchImportPreview);

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
    `http://localhost/organizations/${ORG}/projects/${PROJECT}/inventory${search}`,
  );
  return inventoryLoader({
    request: new Request(url),
    url,
    pattern: "/organizations/:organizationId/projects/:projectId/inventory",
    params: { organizationId: ORG, projectId: PROJECT },
    context: {},
  });
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({
    data: { user: { id: "user-a", emailVerified: true } },
    error: null,
  });
  fetchMeContextMock.mockResolvedValue(owner);
  summaryMock.mockResolvedValue(
    {} as Awaited<ReturnType<typeof fetchInventory>>,
  );
  rowsMock.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
});

afterEach(async () => {
  const client = peekStagedQueryClient()?.client;
  await client?.cancelQueries();
  client?.clear();
  resetQueryClientRegistry();
  vi.resetAllMocks();
});

describe("inventoryLoader", () => {
  it("prefetches the summary and the rows the address asks for", async () => {
    await load(`?system=${SYSTEM}&status=rejected&page=2`);

    expect(summaryMock).toHaveBeenCalledTimes(1);
    expect(rowsMock).toHaveBeenCalledTimes(1);
    expect(rowsMock.mock.calls[0]?.slice(0, 3)).toEqual([
      ORG,
      PROJECT,
      { system: SYSTEM, status: "rejected", page: 2 },
    ]);
  });

  it("asks for the first page of every row when the address has no filter", async () => {
    await load("");

    expect(rowsMock.mock.calls[0]?.[2]).toEqual({ status: "all", page: 1 });
  });
});

describe("inventoryImportLoader", () => {
  const loadImport = () => {
    const url = new URL(
      `http://localhost/organizations/${ORG}/projects/${PROJECT}/inventory/import`,
    );
    return inventoryImportLoader({
      request: new Request(url),
      url,
      pattern:
        "/organizations/:organizationId/projects/:projectId/inventory/import",
      params: { organizationId: ORG, projectId: PROJECT },
      context: {},
    });
  };

  it("prefetches the summary and the caller's own pending preview", async () => {
    summaryMock.mockResolvedValue({
      canUpload: true,
    } as Awaited<ReturnType<typeof fetchInventory>>);
    previewMock.mockResolvedValue({ preview: null });
    await loadImport();

    expect(summaryMock).toHaveBeenCalledTimes(1);
    expect(previewMock.mock.calls[0]?.slice(0, 2)).toEqual([ORG, PROJECT]);
  });

  it("asks a member who may not import for no preview", async () => {
    summaryMock.mockResolvedValue({
      canUpload: false,
    } as Awaited<ReturnType<typeof fetchInventory>>);

    await expect(loadImport()).resolves.toBeNull();
    expect(summaryMock).toHaveBeenCalledTimes(1);
    expect(previewMock).not.toHaveBeenCalled();
  });
});
