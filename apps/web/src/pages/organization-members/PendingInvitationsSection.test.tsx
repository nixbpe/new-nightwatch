import type {
  PendingInvitation,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { fetchPendingInvitations } from "../../lib/api/invitations";
import { PendingInvitationsSection } from "./PendingInvitationsSection";

vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(),
}));
const fetchList = vi.mocked(fetchPendingInvitations);
const refreshMembershipContext = vi.fn(() => Promise.resolve(null));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  fetchList.mockReset();
  refreshMembershipContext.mockClear();
});

function publicId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function invitation(
  n: number,
  email: string,
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    publicId: publicId(n),
    email,
    role: "viewer",
    sentAt: "2026-09-30T08:00:00.000Z",
    expiresAt: "2026-10-02T08:00:00.000Z",
    expired: false,
    resendAvailableAt: "2026-09-30T08:05:00.000Z",
    manageable: true,
    ...overrides,
  };
}

/** Serves `total` rows `row-1@…` onward, `limit`/`offset` sliced like the API. */
function serve(total: number, activeCount = total) {
  fetchList.mockImplementation((organizationId, limit, offset) => {
    const invitations = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, index) =>
        invitation(
          offset + index + 1,
          `row-${String(offset + index + 1)}@example.test`,
        ),
    );
    return Promise.resolve({
      organizationId,
      invitations,
      activeCount,
      activeLimit: 100,
      page: { limit, offset, total },
    });
  });
}

function listOf(
  organizationId: string,
  invitations: PendingInvitation[],
  total = invitations.length,
  activeCount = total,
): PendingInvitationListResponse {
  return {
    organizationId,
    invitations,
    activeCount,
    activeLimit: 100,
    page: { limit: 50, offset: 0, total },
  };
}

function renderSection(organizationId = A) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const ui = (id: string, createdSignal = 0) => (
    <QueryClientProvider client={queryClient}>
      <PendingInvitationsSection
        key={id}
        organizationId={id}
        organizationName="Acme"
        refreshMembershipContext={refreshMembershipContext}
        createdSignal={createdSignal}
      />
    </QueryClientProvider>
  );
  const view = render(ui(organizationId));
  return {
    queryClient,
    container: view.container,
    switchTo: (id: string) => {
      view.rerender(ui(id));
    },
    announceCreated: () => {
      view.rerender(ui(organizationId, 1));
    },
  };
}

describe("PendingInvitationsSection", () => {
  it("returns to page 1 when the page announces a created invitation", async () => {
    serve(120);
    const user = userEvent.setup();
    const { announceCreated } = renderSection();
    await screen.findByText("row-1@example.test");
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    await screen.findByText("row-51@example.test");

    announceCreated();

    await screen.findByText("row-1@example.test");
    expect(screen.queryByText("row-51@example.test")).toBeNull();
  });

  it("shows rows, n of 100, the total and an expired label that is text", async () => {
    fetchList.mockResolvedValue(
      listOf(
        A,
        [
          invitation(1, "live@example.test", { role: "admin" }),
          invitation(2, "old@example.test", {
            expired: true,
            expiresAt: "2026-09-28T08:00:00.000Z",
          }),
          invitation(3, "null@example.test", {
            expired: true,
            expiresAt: null,
          }),
        ],
        3,
        1,
      ),
    );
    renderSection();

    await screen.findByText("live@example.test");
    expect(
      screen.getByRole("heading", { name: /คำเชิญที่รอตอบรับ/ }),
    ).toHaveTextContent("คำเชิญที่รอตอบรับ (1 จาก 100)");
    expect(screen.getByText("คำเชิญที่หมดอายุไม่นับในโควตา")).toBeVisible();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const [live, old, nullDate] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(live).getByText("live@example.test")).toBeVisible();
    expect(within(live).getByText("ผู้ดูแล")).toBeVisible();
    expect(within(live).queryByText("หมดอายุ")).toBeNull();
    expect(within(old).getByText("หมดอายุ")).toBeVisible();
    expect(within(nullDate).getByText("หมดอายุ")).toBeVisible();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["อีเมล", "บทบาท", "ส่งเมื่อ", "หมดอายุ", "การทำงาน"]);
    expect(screen.getByText("คำเชิญทั้งหมด 3 รายการ")).toBeVisible();
    expect(fetchList).toHaveBeenCalledWith(A, 50, 0);
  });

  it("renders no invitation id, public id or link in the DOM", async () => {
    fetchList.mockResolvedValue(
      listOf(A, [invitation(7, "someone@example.test")]),
    );
    const { container } = renderSection();
    await screen.findByText("someone@example.test");

    expect(container.querySelector("a, [href]")).toBeNull();
    expect(container.innerHTML).not.toContain(publicId(7));
    expect(container.innerHTML.toLowerCase()).not.toContain("accept");
  });

  it.each([
    { total: 49, next: false, rows: 49 },
    { total: 50, next: false, rows: 50 },
    { total: 51, next: true, rows: 50 },
  ])(
    "enables next page only past 50 rows ($total rows)",
    async ({ total, next, rows }) => {
      serve(total);
      renderSection();
      await screen.findByText("row-1@example.test");

      expect(screen.getAllByRole("row").slice(1)).toHaveLength(rows);
      expect(
        screen.getByRole("button", { name: "หน้าก่อนหน้า" }),
      ).toBeDisabled();
      const nextButton = screen.getByRole("button", { name: "หน้าถัดไป" });
      if (next) expect(nextButton).toBeEnabled();
      else expect(nextButton).toBeDisabled();
      expect(
        screen.getByText(`คำเชิญทั้งหมด ${String(total)} รายการ`),
      ).toBeVisible();
    },
  );

  it("loads page two by keyboard without old rows, keeps n, then focuses the heading", async () => {
    serve(51, 40);
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("row-1@example.test");

    const second = Promise.withResolvers<PendingInvitationListResponse>();
    fetchList.mockImplementationOnce(() => second.promise);
    const next = screen.getByRole("button", { name: "หน้าถัดไป" });
    next.focus();
    await user.keyboard("{Enter}");

    expect(fetchList).toHaveBeenLastCalledWith(A, 50, 50);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "กำลังโหลดคำเชิญ",
    );
    expect(screen.queryByText("row-1@example.test")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/จาก 100/)).toBeNull();

    second.resolve({
      organizationId: A,
      invitations: [invitation(51, "row-51@example.test")],
      activeCount: 40,
      activeLimit: 100,
      page: { limit: 50, offset: 50, total: 51 },
    });
    expect(await screen.findByText("row-51@example.test")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /คำเชิญที่รอตอบรับ/ }),
    ).toHaveTextContent("(40 จาก 100)");
    expect(
      screen.getByRole("heading", { name: /คำเชิญที่รอตอบรับ/ }),
    ).toHaveFocus();
    expect(screen.getByRole("button", { name: "หน้าถัดไป" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "หน้าก่อนหน้า" })).toBeEnabled();
  });

  it("loads the last page with rows when a refresh returns none past the end", async () => {
    serve(130);
    const user = userEvent.setup();
    const { queryClient } = renderSection();
    await screen.findByText("row-1@example.test");
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    await screen.findByText("row-51@example.test");
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    await screen.findByText("row-101@example.test");

    // Another session cancels rows: 60 remain, so offset 100 is past the end.
    serve(60);
    fetchList.mockImplementationOnce((organizationId, limit, offset) =>
      Promise.resolve({
        ...listOf(organizationId, [], 60),
        page: { limit, offset, total: 60 },
      }),
    );
    await queryClient.invalidateQueries({
      queryKey: ["tenant", "invitations", A],
    });

    expect(await screen.findByText("row-51@example.test")).toBeVisible();
    expect(fetchList).toHaveBeenLastCalledWith(A, 50, 50);
    expect(screen.getByText("คำเชิญทั้งหมด 60 รายการ")).toBeVisible();
  });

  it("shows empty only when the total is 0", async () => {
    fetchList.mockResolvedValue(listOf(A, [], 0));
    renderSection();

    expect(await screen.findByText("ไม่มีคำเชิญที่รอตอบรับ")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading")).toHaveTextContent("(0 จาก 100)");
  });

  it("shows a retryable error instead of empty, then recovers", async () => {
    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByText("โหลดคำเชิญไม่สำเร็จ")).toBeVisible();
    expect(screen.queryByText("ไม่มีคำเชิญที่รอตอบรับ")).toBeNull();
    expect(screen.queryByText(/จาก 100/)).toBeNull();

    fetchList.mockResolvedValueOnce(
      listOf(A, [invitation(1, "back@example.test")]),
    );
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("back@example.test")).toBeVisible();
    expect(screen.queryByText("โหลดคำเชิญไม่สำเร็จ")).toBeNull();
  });

  it("focuses the heading and offers the previous page when the next page fails", async () => {
    serve(51);
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("row-1@example.test");

    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));

    expect(await screen.findByText("โหลดคำเชิญไม่สำเร็จ")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /คำเชิญที่รอตอบรับ/ }),
    ).toHaveFocus();
    expect(screen.queryByText("row-1@example.test")).toBeNull();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "หน้าก่อนหน้า" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("row-1@example.test")).toBeVisible();
    expect(screen.queryByText("โหลดคำเชิญไม่สำเร็จ")).toBeNull();
  });

  it("focuses the heading when a retry succeeds after a failed page change", async () => {
    serve(51);
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("row-1@example.test");

    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    expect(await screen.findByText("โหลดคำเชิญไม่สำเร็จ")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));

    expect(await screen.findByText("row-51@example.test")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /คำเชิญที่รอตอบรับ/ }),
    ).toHaveFocus();
  });

  it("announces loading while a retry runs after a failed refresh", async () => {
    serve(2);
    const user = userEvent.setup();
    const { queryClient } = renderSection();
    await screen.findByText("row-1@example.test");

    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await queryClient.invalidateQueries({
      queryKey: ["tenant", "invitations", A],
    });
    expect(await screen.findByText("โหลดคำเชิญไม่สำเร็จ")).toBeVisible();

    fetchList.mockReturnValueOnce(new Promise(() => undefined));
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "กำลังโหลดคำเชิญ",
    );
    expect(screen.queryByText("โหลดคำเชิญไม่สำเร็จ")).toBeNull();
  });

  it("announces loading and shows no rows while the first request is pending", async () => {
    fetchList.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "กำลังโหลดคำเชิญ",
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("ไม่มีคำเชิญที่รอตอบรับ")).toBeNull();
  });

  it("keeps Organization B untouched by a late response for A", async () => {
    const lateA = Promise.withResolvers<PendingInvitationListResponse>();
    fetchList.mockImplementation((organizationId) =>
      organizationId === A
        ? lateA.promise
        : Promise.resolve(listOf(B, [invitation(2, "b-only@example.test")])),
    );
    const { switchTo } = renderSection(A);
    switchTo(B);
    expect(await screen.findByText("b-only@example.test")).toBeVisible();

    lateA.resolve(listOf(A, [invitation(1, "a-only@example.test")], 9));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText("b-only@example.test")).toBeVisible();
    expect(screen.queryByText("a-only@example.test")).toBeNull();
    expect(screen.getByText("คำเชิญทั้งหมด 1 รายการ")).toBeVisible();
  });

  it("starts Organization B at offset 0 after paging in A", async () => {
    serve(120);
    const user = userEvent.setup();
    const { switchTo } = renderSection(A);
    await screen.findByText("row-1@example.test");
    await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    await screen.findByText("row-51@example.test");

    switchTo(B);
    await screen.findByText("row-1@example.test");
    expect(fetchList).toHaveBeenLastCalledWith(B, 50, 0);
  });
});
