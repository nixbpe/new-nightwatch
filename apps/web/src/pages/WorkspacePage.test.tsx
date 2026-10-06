import type {
  MeContextResponse,
  OrganizationMemberListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MonitorListResponse } from "@nightwatch/api-contract";
import { ApiError } from "../lib/api/client";
import {
  fetchOrganizationMembers,
  memberListQueryKey,
} from "../lib/api/members";
import { fetchMeContext, updateActiveOrganization } from "../lib/api/me";
import {
  fetchMonitorList,
  fetchMonitorRecentEvents,
  monitorQueryKeys,
} from "../lib/api/monitors";
import { TenantProvider } from "../lib/tenant/TenantProvider";
import { OrganizationMembersPage } from "./OrganizationMembersPage";
import { SslCard } from "./monitors/detail/SslCard";
import { formatDate } from "./monitors/format";
import { WorkspacePage } from "./WorkspacePage";
import type { MonitorRow } from "./workspace/rows";

// The page header renders scope as a name plus a pill, so match inside the header.
async function findScope(name: string, tag: string) {
  // Re-query on every retry: the page remounts its header across context refreshes.
  return waitFor(() => {
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    if (header === null) {
      throw new Error("page header missing");
    }
    expect(within(header).getByText(name)).toBeInTheDocument();
    expect(within(header).getByText(tag)).toBeInTheDocument();
    return header;
  });
}

const { sessionState, signOutMock } = vi.hoisted(() => ({
  sessionState: {
    data: null as { user: Record<string, unknown> } | null,
    isPending: false,
  },
  signOutMock: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => sessionState,
    signOut: signOutMock,
    organization: {},
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
  twoFactorClient: () => ({}),
}));

vi.mock("../lib/api/me", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    fetchMeContext: vi.fn(),
    updateActiveOrganization: vi.fn(),
  };
});
vi.mock("../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(async (organizationId: string) =>
    (await import("../test/pendingInvitations")).emptyPendingInvitationList(
      organizationId,
    ),
  ),
}));
vi.mock("../lib/api/members", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOrganizationMembers: vi.fn(),
}));

vi.mock("../lib/api/monitors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonitorList: vi.fn(),
  fetchMonitorRecentEvents: vi.fn(),
}));

const fetchMeContextMock = vi.mocked(fetchMeContext);
const fetchMonitorListMock = vi.mocked(fetchMonitorList);
const fetchMonitorRecentEventsMock = vi.mocked(fetchMonitorRecentEvents);
const updateActiveOrganizationMock = vi.mocked(updateActiveOrganization);
const fetchOrganizationMembersMock = vi.mocked(fetchOrganizationMembers);

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const MONITOR_A = "33333333-3333-4333-8333-333333333333";
const MONITOR_B = "44444444-4444-4444-8444-444444444444";
const okUptime = { percent: 99.5, checks: 10, coveragePercent: 100 };

function monitorItem(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    url: `https://${name}.example.com/health`,
    method: "GET",
    intervalSeconds: 300,
    status: "active",
    health: "up",
    healthReason: null,
    lastKnownDown: false,
    consecutiveFailures: 0,
    lastCheckAt: "2026-10-02T05:00:00.000Z",
    openIncident: null,
    lastResponseTimeMs: 120,
    responseSparkline: Array.from({ length: 24 }, (_, hour) => ({
      hourStart: new Date(Date.UTC(2026, 9, 1, 6 + hour)).toISOString(),
      avgMs: null,
    })),
    ssl: {
      level: "ok",
      daysRemaining: 90,
      host: `${name}.example.com`,
      issuer: null,
      notAfter: null,
    },
    uptime: { h24: okUptime, d30: okUptime },
    ...overrides,
  } as MonitorRow;
}

function monitorList(total = 3): MonitorListResponse {
  return {
    summary: { up: 1, down: 1, unknown: 0, paused: 0, total, limit: 50 },
    monitors: [
      monitorItem(MONITOR_A, "api-payments", {
        health: "down",
        consecutiveFailures: 3,
        openIncident: {
          startedAt: "2026-10-02T04:00:00.000Z",
          reason: "dns_not_found",
        },
      }),
      monitorItem(MONITOR_B, "portal", {
        ssl: {
          level: "caution",
          daysRemaining: 12,
          host: "portal.example.com",
          issuer: "Let's Encrypt R11",
          notAfter: "2026-10-14T05:00:00.000Z",
        },
      }),
    ],
    page: { limit: 50, offset: 0, total },
    dataAsOf: "2026-10-02T05:00:00.000Z",
  };
}

function meContext(
  organizations: MeContextResponse["organizations"],
  lastActiveTenantId: string | null = null,
): MeContextResponse {
  return {
    user: {
      id: "user-1",
      name: "ผู้ใช้ทดสอบ",
      email: "user@example.com",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    organizations,
    lastActiveTenantId,
  };
}

const ownerOrg = {
  id: ORG_A,
  name: "Org A",
  slug: "org-a",
  role: "owner" as const,
};
const viewerOrg = {
  id: ORG_B,
  name: "Org B",
  slug: "org-b",
  role: "viewer" as const,
};

const staleMemberPage: OrganizationMemberListResponse = {
  organizationId: ORG_A,
  members: [
    {
      id: "member-1",
      userId: "user-1",
      name: "Cached member",
      email: "cached@example.test",
      role: "owner",
    },
  ],
  page: { limit: 50, offset: 0, total: 51 },
  memberLimit: 1000,
};

function renderPage() {
  if (fetchMonitorListMock.getMockImplementation() === undefined) {
    fetchMonitorListMock.mockResolvedValue(monitorList());
  }
  if (fetchMonitorRecentEventsMock.getMockImplementation() === undefined) {
    fetchMonitorRecentEventsMock.mockResolvedValue({ events: [] });
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route
            path="/workspace"
            element={
              <TenantProvider>
                <WorkspacePage />
              </TenantProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDeniedMembershipPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(memberListQueryKey(ORG_A, 50, 0), staleMemberPage);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${ORG_A}/members`]}>
        <TenantProvider>
          <Link to="/workspace">ไปภาพรวม</Link>
          <Routes>
            <Route
              path="/organizations/:organizationId/members"
              element={<OrganizationMembersPage />}
            />
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </TenantProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("WorkspacePage context states", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    signOutMock.mockReset();
    sessionState.data = null;
    fetchOrganizationMembersMock.mockReset();
  });

  it("shows loading only while the context is actually pending, then renders the organization", async () => {
    // A slow /me response is a pending state that resolves into content, never a permanent spinner.
    const pending = Promise.withResolvers<MeContextResponse>();
    fetchMeContextMock.mockImplementation(() => pending.promise);
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "กำลังโหลดข้อมูลองค์กร…",
    );

    pending.resolve(meContext([ownerOrg], ORG_A));

    await findScope("Org A", "เจ้าของ");
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("a failed context load offers an explicit retry that recovers", async () => {
    // A /me failure is a retryable error state, not the spinner or the zero-membership screen.
    fetchMeContextMock.mockRejectedValueOnce(
      new ApiError("INTERNAL", "server exploded", 500),
    );
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "โหลดข้อมูลองค์กรไม่สำเร็จ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
      }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

    await findScope("Org A", "เจ้าของ");
  });

  it("a successful context with zero memberships shows the access-needed state", async () => {
    // Access-needed is exclusively the successful zero-membership outcome.
    fetchMeContextMock.mockResolvedValue(meContext([]));
    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่เป็นสมาชิกขององค์กรใด/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
  });

  it.each([
    {
      name: "B",
      error: new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      retryContext: meContext([viewerOrg], ORG_B),
      expected: ["Org B", "ผู้ชม"] as const,
    },
    {
      name: "downgraded role",
      error: new ApiError("PERMISSION_DENIED", "role downgraded", 403),
      retryContext: meContext([{ ...ownerOrg, role: "viewer" }], ORG_A),
      expected: ["Org A", "ผู้ชม"] as const,
    },
    {
      name: "no-access",
      error: new ApiError("MEMBERSHIP_DENIED", "membership revoked", 403),
      retryContext: meContext([]),
      expected: "ยังไม่ได้รับสิทธิ์เข้าถึงองค์กร",
    },
  ])(
    "does not republish denied A before retry confirms $name",
    async ({ error, retryContext, expected }) => {
      fetchMeContextMock
        .mockResolvedValueOnce(meContext([ownerOrg], ORG_A))
        .mockRejectedValueOnce(new Error("context unavailable"))
        .mockResolvedValueOnce(retryContext);
      fetchOrganizationMembersMock.mockRejectedValueOnce(error);
      const user = userEvent.setup();
      const queryClient = renderDeniedMembershipPage();

      expect(
        await screen.findByRole("button", { name: "ลองอีกครั้ง" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Org A · org-a")).toBeNull();
      expect(screen.queryByText("สมาชิกทั้งหมด 51 คน")).toBeNull();
      expect(
        queryClient.getQueryData(["tenant", "members", ORG_A]),
      ).toBeUndefined();
      expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();

      await user.click(screen.getByRole("link", { name: "ไปภาพรวม" }));
      expect(
        await screen.findByRole("heading", {
          name: "โหลดข้อมูลองค์กรไม่สำเร็จ",
        }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

      if (typeof expected === "string") {
        expect(await screen.findByText(expected)).toBeInTheDocument();
      } else {
        await findScope(expected[0], expected[1]);
      }
      expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
      expect(
        screen.queryByRole("heading", {
          name: "โหลดข้อมูลองค์กรไม่สำเร็จ",
        }),
      ).toBeNull();
      expect(fetchOrganizationMembersMock).toHaveBeenCalledOnce();
    },
  );
});

describe("WorkspacePage organization views", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    updateActiveOrganizationMock.mockReset();
    signOutMock.mockReset();
    sessionState.data = null;
  });

  it("an owner sees overview without the removed invitation form", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    await findScope("Org A", "เจ้าของ");
    expect(screen.queryByRole("button", { name: "ส่งคำเชิญ" })).toBeNull();
    expect(screen.queryByLabelText("อีเมลของผู้ได้รับเชิญ")).toBeNull();
  });
});

describe("WorkspacePage overview content", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    sessionState.data = null;
  });

  it("shows the eyebrow, status line, stats and the problem monitors", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 2, name: "ต้องดูตอนนี้" }),
    ).toBeInTheDocument();
    expect(screen.getByText("// overview")).toBeInTheDocument();
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "ภาพรวม",
    });
    expect(heading).toBeInTheDocument();
    // A fresh, successfully loaded list shows the live indicator beside "ข้อมูล ณ".
    const header = heading.closest("header");
    expect(header).not.toBeNull();
    const liveDot = (header as HTMLElement).querySelector(".live-pulse");
    expect(liveDot).toBeInTheDocument();
    expect(liveDot).toHaveAttribute("aria-hidden", "true");
    const stats = screen.getByRole("region", { name: "สรุปสถานะ" });
    expect(within(stats).getAllByRole("link")).toHaveLength(4);
    const issues = screen
      .getByRole("heading", { name: "ต้องดูตอนนี้" })
      .closest("section");
    expect(issues).not.toBeNull();
    expect(
      within(issues as HTMLElement).getByText("api-payments"),
    ).toBeInTheDocument();
    expect(
      within(issues as HTMLElement).getByText("portal"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "เพิ่มมอนิเตอร์" }),
    ).toHaveAttribute("href", `/organizations/${ORG_A}/monitors/new`);
  });

  it("marks every remaining sample region as an example with its issue link", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();

    await screen.findByRole("heading", { level: 2, name: "ต้องดูตอนนี้" });
    const samples = screen.getAllByRole("group", { name: /^ตัวอย่าง: / });
    expect(samples).toHaveLength(2);
    const issues = samples.map((sample) =>
      within(sample)
        .getByRole("link", { name: /ดู issue #/ })
        .getAttribute("href"),
    );
    expect(issues.map((href) => /(\d+)$/.exec(href ?? "")?.[1])).toEqual(
      expect.arrayContaining(["56", "63"]),
    );
    // Only the real expiry line carries a date; no sample region does.
    for (const sample of samples) {
      expect(within(sample).queryByText(/\d{1,2} ต\.ค\. \d{4}/)).toBeNull();
    }
    for (const sample of samples) {
      expect(
        within(sample).getByText("ตัวอย่าง · ยังไม่เชื่อมข้อมูลจริง"),
      ).toBeInTheDocument();
      expect(
        within(sample).getByRole("link", { name: /ดู issue #/ }),
      ).toHaveAttribute("target", "_blank");
    }
  });

  it("a viewer sees no add button", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([viewerOrg], ORG_B));
    renderPage();

    await screen.findByRole("heading", { level: 2, name: "ต้องดูตอนนี้" });
    expect(screen.queryByRole("link", { name: "เพิ่มมอนิเตอร์" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "ดูมอนิเตอร์ทั้งหมด" }),
    ).toBeInTheDocument();
  });

  it("measures the outage against the server's dataAsOf, not the client clock", async () => {
    // Incident starts 04:00Z and dataAsOf is 05:00Z; a client clock a day ahead must not show "1 วัน".
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-03T05:00:00Z"),
    });
    try {
      fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
      renderPage();
      const issues = (
        await screen.findByRole("heading", { name: "ต้องดูตอนนี้" })
      ).closest("section") as HTMLElement;
      expect(within(issues).getByText("1 ชั่วโมง")).toBeInTheDocument();
      expect(within(issues).queryByText("1 วัน")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an organization without monitors shows the first-run state", async () => {
    fetchMonitorListMock.mockResolvedValue({
      ...monitorList(0),
      summary: { up: 0, down: 0, unknown: 0, paused: 0, total: 0, limit: 50 },
      monitors: [],
    });
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();

    expect(await screen.findByText("ยังไม่มีมอนิเตอร์")).toBeInTheDocument();
  });

  it("a failed list offers a retry", async () => {
    fetchMonitorListMock.mockRejectedValueOnce(new Error("boom"));
    fetchMonitorListMock.mockResolvedValue(monitorList());
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText("โหลดมอนิเตอร์ไม่สำเร็จ"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "ต้องดูตอนนี้" }),
    ).toBeInTheDocument();
  });
});

describe("WorkspacePage denied list", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    sessionState.data = null;
  });

  it("a denied first load refreshes the membership context and shows no organization data", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchMonitorListMock.mockRejectedValue(
      new ApiError("MEMBERSHIP_DENIED", "revoked", 403),
    );
    renderPage();

    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(fetchMeContextMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Org A")).toBeNull();
    expect(screen.queryByText("api-payments")).toBeNull();
  });

  it("a denied refetch after a successful load drops the cached monitors", async () => {
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    fetchMonitorListMock.mockResolvedValueOnce(monitorList());
    fetchMonitorListMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "revoked", 403),
    );
    fetchMonitorRecentEventsMock.mockResolvedValue({ events: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <TenantProvider>
            <WorkspacePage />
          </TenantProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findAllByText("api-payments")).not.toHaveLength(0);
    const callsBefore = fetchMeContextMock.mock.calls.length;

    await queryClient.refetchQueries({ queryKey: monitorQueryKeys.all(ORG_A) });

    expect(
      await screen.findByText("คุณไม่มีสิทธิ์ดูมอนิเตอร์ขององค์กรนี้"),
    ).toBeInTheDocument();
    expect(screen.queryByText("api-payments")).toBeNull();
    expect(screen.queryByText("portal")).toBeNull();
    await waitFor(() => {
      expect(fetchMeContextMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe("WorkspacePage overview details", () => {
  afterEach(() => {
    fetchMeContextMock.mockReset();
    fetchMonitorListMock.mockReset();
    fetchMonitorRecentEventsMock.mockReset();
    sessionState.data = null;
  });

  it("shows issuer and expiry on SSL warning rows only when present, never on a down row", async () => {
    const notAfter = "2026-10-14T05:00:00.000Z";
    const ssl = (level: "caution" | "danger" | "expired", extra = {}) => ({
      level,
      daysRemaining: 12,
      host: "h.example.com",
      issuer: null,
      notAfter: null,
      ...extra,
    });
    const list = monitorList(5);
    list.monitors = [
      monitorItem(MONITOR_A, "api-payments", {
        health: "down",
        openIncident: {
          startedAt: "2026-10-02T04:00:00.000Z",
          reason: "dns_not_found",
        },
        ssl: ssl("danger", { issuer: "Down CA", notAfter }),
      }),
      monitorItem(MONITOR_B, "portal", {
        ssl: ssl("caution", { issuer: "Let's Encrypt R11", notAfter }),
      }),
      monitorItem("55555555-5555-4555-8555-555555555555", "bare", {
        ssl: ssl("expired"),
      }),
      monitorItem("66666666-6666-4666-8666-666666666666", "issuer-only", {
        ssl: ssl("danger", { issuer: "Only CA" }),
      }),
      monitorItem("77777777-7777-4777-8777-777777777777", "date-only", {
        ssl: ssl("caution", { notAfter }),
      }),
    ];
    fetchMonitorListMock.mockResolvedValue(list);
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const issues = (
      await screen.findByRole("heading", { name: "ต้องดูตอนนี้" })
    ).closest("section") as HTMLElement;
    const row = (name: string) =>
      within(issues).getByText(name).closest("a") as HTMLElement;

    const portal = within(row("portal"));
    const issuer = portal.getByText("ผู้ออก Let's Encrypt R11");
    expect(issuer).toHaveClass("[overflow-wrap:anywhere]");
    const expiry = portal.getByText(formatDate(notAfter));
    expect(expiry).toHaveAttribute("datetime", notAfter);
    expect(expiry.parentElement).toHaveTextContent(
      `หมดอายุ ${formatDate(notAfter)}`,
    );
    expect(expiry.closest(".font-mono")).toBeNull();

    expect(within(row("bare")).queryByText(/ผู้ออก|หมดอายุ \d/)).toBeNull();
    const issuerOnly = within(row("issuer-only"));
    expect(issuerOnly.getByText("ผู้ออก Only CA")).toBeInTheDocument();
    expect(issuerOnly.queryByText(/หมดอายุ \d/)).toBeNull();
    const dateOnly = within(row("date-only"));
    expect(dateOnly.queryByText(/ผู้ออก/)).toBeNull();
    expect(dateOnly.getByText(formatDate(notAfter))).toBeInTheDocument();

    const down = within(row("api-payments"));
    expect(down.queryByText(/Down CA/)).toBeNull();
    expect(down.queryByText(formatDate(notAfter))).toBeNull();
    expect(down.getByText("หมดอายุใน 12 วัน")).toBeInTheDocument();
  });

  it("writes the expiry date exactly as the monitor detail SSL card does", async () => {
    fetchMonitorListMock.mockResolvedValue(monitorList());
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const issues = (
      await screen.findByRole("heading", { name: "ต้องดูตอนนี้" })
    ).closest("section") as HTMLElement;
    const workspaceDate = issues.querySelector(
      'time[datetime="2026-10-14T05:00:00.000Z"]',
    )?.textContent;
    const card = render(
      <SslCard
        ssl={{
          state: "caution",
          daysRemaining: 12,
          host: "portal.example.com",
          issuer: "Let's Encrypt R11",
          notAfter: "2026-10-14T05:00:00.000Z",
          reason: null,
        }}
      />,
    );
    expect(workspaceDate).toBeTruthy();
    expect(card.container.querySelector("time")?.textContent).toBe(
      workspaceDate,
    );
  });

  it("limit reached disables add with its reason", async () => {
    fetchMonitorListMock.mockResolvedValue(monitorList(50));
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const add = await screen.findByRole("button", { name: "เพิ่มมอนิเตอร์" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("aria-describedby", "monitor-limit-reason");
    expect(screen.getByText(/ครบ 50 ตัวแล้ว/)).toBeInTheDocument();
  });

  it("shows tile values, expired note and orders down before SSL rows", async () => {
    const list = monitorList(3);
    list.monitors.push(
      monitorItem("55555555-5555-4555-8555-555555555555", "legacy", {
        ssl: {
          level: "expired",
          daysRemaining: -2,
          host: "legacy.example.com",
          issuer: null,
          notAfter: null,
        },
      }),
    );
    list.monitors.reverse();
    fetchMonitorListMock.mockResolvedValue(list);
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    renderPage();
    const stats = await screen.findByRole("region", { name: "สรุปสถานะ" });
    const [, downTile, sslTile] = within(stats).getAllByRole("link");
    expect(downTile).toHaveTextContent("api-payments");
    expect(sslTile).toHaveTextContent("2");
    expect(sslTile).toHaveTextContent("หมดอายุแล้ว 1");
    const issues = screen
      .getByRole("heading", { name: "ต้องดูตอนนี้" })
      .closest("section") as HTMLElement;
    const names = within(issues)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(names.findIndex((t) => t.includes("api-payments"))).toBeLessThan(
      names.findIndex((t) => t.includes("portal")),
    );
  });

  it("renders no-data uptime, populated events and the stale warning", async () => {
    const list = monitorList();
    list.monitors[1] = monitorItem(MONITOR_B, "portal", {
      uptime: {
        h24: okUptime,
        d30: { percent: null, checks: 0, coveragePercent: 0 },
      },
    });
    fetchMonitorListMock.mockResolvedValueOnce(list);
    fetchMonitorListMock.mockRejectedValue(new Error("boom"));
    fetchMonitorRecentEventsMock.mockResolvedValue({
      events: [
        {
          kind: "incident_opened",
          at: "2026-10-02T04:00:00.000Z",
          monitorId: MONITOR_A,
          monitorName: "api-payments",
          reason: "dns_not_found",
          httpStatus: 503,
        },
      ],
    });
    fetchMeContextMock.mockResolvedValue(meContext([ownerOrg], ORG_A));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <TenantProvider>
            <WorkspacePage />
          </TenantProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const events = (
      await screen.findByRole("heading", { name: "เหตุการณ์ล่าสุด" })
    ).closest("section") as HTMLElement;
    expect(
      await within(events).findByRole("link", { name: "api-payments" }),
    ).toHaveAttribute("href", `/organizations/${ORG_A}/monitors/${MONITOR_A}`);
    expect(events).toHaveTextContent(
      "เริ่มล่ม สาเหตุ ไม่พบชื่อโดเมน · HTTP 503",
    );
    expect(screen.getAllByText("ไม่มีข้อมูล").length).toBeGreaterThan(0);

    await queryClient.refetchQueries({ queryKey: monitorQueryKeys.all(ORG_A) });
    expect(
      await screen.findByText(/อัปเดตข้อมูลไม่สำเร็จ/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("portal").length).toBeGreaterThan(0);
    // A failed background refetch keeps the cached (now stale) data on screen,
    // so the live indicator must not keep pulsing beside it (CMP-01, MOT-01).
    const heading = screen.getByRole("heading", { level: 1, name: "ภาพรวม" });
    const header = heading.closest("header");
    expect(header).not.toBeNull();
    expect((header as HTMLElement).querySelector(".live-pulse")).toBeNull();
  });
});
