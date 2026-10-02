import type {
  InvitationResendResponse,
  PendingInvitation,
  PendingInvitationListResponse,
} from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import {
  cancelInvitation,
  fetchPendingInvitations,
  resendInvitation,
} from "../../lib/api/invitations";
import { ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { PendingInvitationsSection } from "./PendingInvitationsSection";

vi.mock("../../lib/api/invitations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPendingInvitations: vi.fn(),
  resendInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
}));
const cancelRequest = vi.mocked(cancelInvitation);
const fetchList = vi.mocked(fetchPendingInvitations);
const resendRequest = vi.mocked(resendInvitation);
const refreshMembershipContext = vi.fn(() => Promise.resolve(null));
const A = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.useRealTimers();
  fetchList.mockReset();
  resendRequest.mockReset();
  cancelRequest.mockReset();
  refreshMembershipContext.mockClear();
});

const publicId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const emailOf = (n: number) => `row-${String(n)}@example.test`;
const LONG_AGO = "2026-09-30T08:05:00.000Z";

function invitation(
  n: number,
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    publicId: publicId(n),
    email: emailOf(n),
    role: "viewer",
    sentAt: "2026-09-30T08:00:00.000Z",
    expiresAt: "2026-10-02T08:00:00.000Z",
    expired: false,
    resendAvailableAt: LONG_AGO,
    manageable: true,
    ...overrides,
  };
}

/** Serves `order` (1-based ids, listed order) sliced like the API. */
function serve(order: number[], cooling: ReadonlySet<number> = new Set()) {
  fetchList.mockImplementation((organizationId, limit, offset) =>
    Promise.resolve({
      organizationId,
      invitations: order.slice(offset, offset + limit).map((n) =>
        invitation(
          n,
          cooling.has(n)
            ? {
                resendAvailableAt: new Date(Date.now() + 300_000).toISOString(),
              }
            : {},
        ),
      ),
      activeCount: order.length,
      activeLimit: 100,
      page: { limit, offset, total: order.length },
    } satisfies PendingInvitationListResponse),
  );
}
const range = (count: number) =>
  Array.from({ length: count }, (_, index) => index + 1);

const resent = (
  emailDispatch: "accepted" | "failed" = "accepted",
): InvitationResendResponse => ({
  resent: true,
  emailDispatch,
  sentAt: "2026-10-01T08:00:00.000Z",
  expiresAt: "2026-10-03T08:00:00.000Z",
  resendAvailableAt: "2026-10-01T08:05:00.000Z",
});

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PendingInvitationsSection
        organizationId={A}
        organizationName="Acme"
        refreshMembershipContext={refreshMembershipContext}
        createdSignal={0}
      />
    </QueryClientProvider>,
  );
  return { queryClient };
}

const resendButton = (n: number) =>
  screen.getByRole("button", { name: `ส่งซ้ำคำเชิญถึง ${emailOf(n)}` });
const confirmButton = () =>
  within(screen.getByRole("dialog")).getByRole("button", {
    name: "ยืนยันการส่งคำเชิญซ้ำ",
  });
const heading = () =>
  screen.getByRole("heading", { name: /คำเชิญที่รอตอบรับ/ });
const sectionStatus = () =>
  screen
    .getAllByRole("status")
    .find((node) => node.closest("section") !== null) as HTMLElement;
const textStatusCount = () =>
  screen.getAllByRole("status").filter((node) => node.textContent !== "")
    .length;

async function openAndConfirm(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
) {
  await user.click(resendButton(n));
  await user.click(confirmButton());
}

describe("invitation resend", () => {
  it("opens a confirmation naming the email, role, Organization and impact, with no id or link", async () => {
    serve(range(2));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(resendButton(1));

    const dialog = screen.getByRole("dialog", {
      name: "ยืนยันการส่งคำเชิญซ้ำ",
    });
    expect(dialog).toHaveTextContent(emailOf(1));
    expect(dialog).toHaveTextContent("ผู้ชม");
    expect(dialog).toHaveTextContent("Acme");
    expect(dialog).toHaveTextContent(
      "ลิงก์เชิญเดิมจะใช้ไม่ได้ ระบบส่งลิงก์ใหม่ที่มีอายุ 48 ชั่วโมง",
    );
    expect(document.body.innerHTML).not.toContain(publicId(1));
    expect(document.body.innerHTML).not.toMatch(/https?:\/\//);
    expect(resendRequest).not.toHaveBeenCalled();
  });

  it("sends no request on กลับ or Escape and returns focus to the opener", async () => {
    serve(range(2));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(resendButton(2));
    await user.click(screen.getByRole("button", { name: "กลับ" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(resendButton(2)).toHaveFocus();

    await user.click(resendButton(1));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(resendButton(1)).toHaveFocus();
    expect(resendRequest).not.toHaveBeenCalled();
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it("sends one request for stacked confirms, blocks other actions and shows success only after the refreshed list", async () => {
    const order = range(3);
    serve(order);
    const held = Promise.withResolvers<InvitationResendResponse>();
    resendRequest.mockReturnValue(held.promise);
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(resendButton(2));
    await user.dblClick(confirmButton());
    expect(resendRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("กำลังส่ง…");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "กำลังส่ง…",
      }),
    ).toBeDisabled();
    expect(textStatusCount()).toBe(1);
    expect(resendButton(1)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `ยกเลิกคำเชิญถึง ${emailOf(1)}` }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();

    // The server confirmed; the refetched first page has not arrived.
    const refreshed = Promise.withResolvers<PendingInvitationListResponse>();
    fetchList.mockReturnValueOnce(refreshed.promise);
    held.resolve(resent());
    await waitFor(() => {
      expect(fetchList).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("ส่งคำเชิญซ้ำแล้ว")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sectionStatus()).toHaveTextContent("กำลังส่ง…");

    refreshed.resolve({
      organizationId: A,
      invitations: [2, 1, 3].map((n) => invitation(n)),
      activeCount: 3,
      activeLimit: 100,
      page: { limit: 50, offset: 0, total: 3 },
    });
    expect(await screen.findByText("ส่งคำเชิญซ้ำแล้ว")).toBeVisible();
    expect(sectionStatus()).toHaveTextContent("ส่งคำเชิญซ้ำแล้ว");
    expect(heading()).toHaveTextContent("(3 จาก 100)");
    expect(resendRequest).toHaveBeenCalledTimes(1);
    expect(resendRequest).toHaveBeenCalledWith(A, publicId(2));
  });

  it("warns without retrying when SMTP did not accept the mail", async () => {
    serve(range(2));
    resendRequest.mockResolvedValue(resent("failed"));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await openAndConfirm(user, 1);

    expect(
      await screen.findByText("ส่งคำเชิญซ้ำแล้ว แต่อีเมลส่งไม่สำเร็จ"),
    ).toBeVisible();
    expect(screen.queryByText("ส่งคำเชิญซ้ำแล้ว")).toBeNull();
    expect(resendRequest).toHaveBeenCalledTimes(1);
  });

  it.each(["accepted", "failed"] as const)(
    "reloads the first page after a resend from page two (SMTP %s) and focuses the cooling button of the same row",
    async (dispatch) => {
      const order = range(60);
      serve(order);
      resendRequest.mockImplementation(() => {
        // The resent row (55) now leads the list and is cooling down.
        order.splice(order.indexOf(55), 1);
        order.unshift(55);
        serve(order, new Set([55]));
        return Promise.resolve(resent(dispatch));
      });
      const user = userEvent.setup();
      renderSection();
      await screen.findByText(emailOf(1));
      await user.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
      await screen.findByText(emailOf(55));

      await openAndConfirm(user, 55);

      await screen.findByText(
        dispatch === "accepted"
          ? "ส่งคำเชิญซ้ำแล้ว"
          : "ส่งคำเชิญซ้ำแล้ว แต่อีเมลส่งไม่สำเร็จ",
      );
      expect(fetchList.mock.calls.map((call) => call[2])).toEqual([0, 50, 0]);
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveTextContent(emailOf(55));
      const button = resendButton(55);
      await waitFor(() => {
        expect(button).toHaveFocus();
      });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleDescription(/^ส่งซ้ำได้อีกครั้งเมื่อ .+/);
    },
  );

  it("does nothing when the cooling button is activated", async () => {
    serve(range(2), new Set([1]));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(resendButton(1));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(resendRequest).not.toHaveBeenCalled();
    expect(resendButton(2)).not.toHaveAttribute("aria-disabled");
  });

  it("opens no dialog on Enter or Space while the button is cooling", async () => {
    serve(range(2), new Set([1]));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    resendButton(1).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(resendRequest).not.toHaveBeenCalled();
  });

  it("keeps the button cooling at second 299 and enables it at second 300 on the browser clock", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-01T08:00:00.000Z"));
    fetchList.mockImplementation((organizationId, limit, offset) =>
      Promise.resolve({
        organizationId,
        invitations: [
          invitation(1, { resendAvailableAt: "2026-10-01T08:05:00.000Z" }),
        ],
        activeCount: 1,
        activeLimit: 100,
        page: { limit, offset, total: 1 },
      }),
    );
    renderSection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(resendButton(1)).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_000);
    });
    expect(resendButton(1)).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(resendButton(1)).not.toHaveAttribute("aria-disabled");
    expect(
      screen.queryByText(/ส่งซ้ำได้อีกครั้งเมื่อ/, { selector: "span" }),
    ).toBeNull();
  });

  it("enables every cooling row at its own deadline, not only the earliest", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-01T08:00:00.000Z"));
    const deadlines = ["2026-10-01T08:01:00.000Z", "2026-10-01T08:03:00.000Z"];
    fetchList.mockImplementation((organizationId, limit, offset) =>
      Promise.resolve({
        organizationId,
        invitations: deadlines.map((resendAvailableAt, index) =>
          invitation(index + 1, { resendAvailableAt }),
        ),
        activeCount: 2,
        activeLimit: 100,
        page: { limit, offset, total: 2 },
      }),
    );
    renderSection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(resendButton(1)).not.toHaveAttribute("aria-disabled");
    expect(resendButton(2)).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(119_000);
    });
    expect(resendButton(2)).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(resendButton(2)).not.toHaveAttribute("aria-disabled");
  });

  it.each([
    [
      new ApiError("INVITATION_LIMIT_REACHED", "full", 409),
      "องค์กรมีคำเชิญที่รอดำเนินการครบ 100 รายการแล้ว",
    ],
    [new ApiError("INVITATION_NOT_FOUND", "gone", 404), "ไม่พบคำเชิญนี้แล้ว"],
    [
      new ApiError("USER_ALREADY_MEMBER", "member", 409),
      "ผู้รับเป็นสมาชิกแล้ว",
    ],
    [
      new ApiError("INVITATION_ALREADY_PENDING", "dup", 409),
      "มีคำเชิญที่ยังใช้ได้สำหรับอีเมลนี้แล้ว",
    ],
    [
      new ApiError("INTERNAL_ERROR", "boom", 500),
      "ส่งคำเชิญซ้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    ],
  ])(
    "shows one message without an email, refreshes and never shows success for %o",
    async (failure, message) => {
      serve(range(2));
      resendRequest.mockRejectedValue(failure);
      const user = userEvent.setup();
      renderSection();
      await screen.findByText(emailOf(1));

      await openAndConfirm(user, 2);

      expect(await screen.findByText(message)).toBeVisible();
      expect(sectionStatus()).not.toHaveTextContent("@");
      expect(screen.queryByText(/ส่งคำเชิญซ้ำแล้ว/)).toBeNull();
      expect(resendRequest).toHaveBeenCalledTimes(1);
      expect(fetchList).toHaveBeenCalledTimes(2);
      expect(fetchList.mock.calls.map((call) => call[2])).toEqual([0, 0]);
      expect(refreshMembershipContext).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(resendButton(2)).toHaveFocus();
      });
    },
  );

  it("shows the cooldown time from details.resendAvailableAt and keeps the row", async () => {
    serve(range(2));
    resendRequest.mockRejectedValue(
      new ApiError("INVITATION_RESEND_COOLDOWN", "cooldown", 429, {
        resendAvailableAt: "2026-10-01T08:05:00.000Z",
      }),
    );
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await openAndConfirm(user, 1);

    await waitFor(() => {
      expect(sectionStatus()).toHaveTextContent(/^ส่งซ้ำได้อีกครั้งเมื่อ .+/);
    });
    expect(sectionStatus()).not.toHaveTextContent("@");
    expect(screen.getByText(emailOf(1), { selector: "td" })).toBeVisible();
    expect(fetchList).toHaveBeenCalledTimes(2);
  });

  it("falls back to the generic message when the cooldown carries no usable time", async () => {
    serve(range(1));
    resendRequest.mockRejectedValue(
      new ApiError("INVITATION_RESEND_COOLDOWN", "cooldown", 429, {}),
    );
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await openAndConfirm(user, 1);

    expect(
      await screen.findByText("ส่งคำเชิญซ้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"),
    ).toBeVisible();
  });

  it("shows the refreshed list and the 404 message, without replay, when another session accepted or canceled the row", async () => {
    const order = range(2);
    serve(order);
    resendRequest.mockImplementation(() => {
      order.splice(order.indexOf(1), 1);
      return Promise.reject(new ApiError("INVITATION_NOT_FOUND", "gone", 404));
    });
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await openAndConfirm(user, 1);

    expect(await screen.findByText("ไม่พบคำเชิญนี้แล้ว")).toBeVisible();
    expect(screen.queryByText(emailOf(1), { selector: "td" })).toBeNull();
    expect(resendRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/ส่งคำเชิญซ้ำแล้ว/)).toBeNull();
    await waitFor(() => {
      // The resent row is gone, so focus falls back to the heading.
      expect(heading()).toHaveFocus();
    });
  });

  it("focuses the heading when the refetch after a success fails", async () => {
    serve(range(2));
    resendRequest.mockResolvedValue(resent());
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(resendButton(1));
    fetchList.mockRejectedValueOnce(
      new ApiError("INTERNAL_ERROR", "boom", 500),
    );
    await user.click(confirmButton());

    expect(await screen.findByText("โหลดคำเชิญไม่สำเร็จ")).toBeVisible();
    expect(screen.queryByText(/ส่งคำเชิญซ้ำแล้ว/)).toBeNull();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
  });

  it.each(["PERMISSION_DENIED", "MEMBERSHIP_DENIED"])(
    "refreshes the membership context and shows no success on %s (demotion)",
    async (code) => {
      serve(range(2));
      resendRequest.mockRejectedValue(new ApiError(code, "denied", 403));
      const user = userEvent.setup();
      const { queryClient } = renderSection();
      queryClient.setQueryData(ME_CONTEXT_QUERY_KEY, { marker: true });
      await screen.findByText(emailOf(1));

      await openAndConfirm(user, 1);

      expect(
        await screen.findByText("ส่งคำเชิญซ้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"),
      ).toBeVisible();
      expect(screen.queryByText(/ส่งคำเชิญซ้ำแล้ว/)).toBeNull();
      await waitFor(() => {
        expect(refreshMembershipContext).toHaveBeenCalledTimes(1);
      });
      expect(
        queryClient.getQueryState(ME_CONTEXT_QUERY_KEY)?.isInvalidated,
      ).toBe(true);
      expect(resendRequest).toHaveBeenCalledTimes(1);
      expect(fetchList).toHaveBeenCalledTimes(2);
    },
  );

  it("shows no resend button for a row the actor cannot manage", async () => {
    fetchList.mockResolvedValue({
      organizationId: A,
      invitations: [
        invitation(1, { role: "owner", manageable: false }),
        invitation(2),
      ],
      activeCount: 2,
      activeLimit: 100,
      page: { limit: 50, offset: 0, total: 2 },
    });
    renderSection();
    await screen.findByText(emailOf(1));

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0] as HTMLElement).queryByRole("button")).toBeNull();
    expect(
      within(rows[0] as HTMLElement).getByText("เฉพาะเจ้าของจัดการได้"),
    ).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByRole("button", {
        name: `ส่งซ้ำคำเชิญถึง ${emailOf(2)}`,
      }),
    ).toBeVisible();
  });

  it("traps Tab inside the dialog between กลับ and the confirm button", async () => {
    serve(range(2));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(resendButton(1));
    const back = screen.getByRole("button", { name: "กลับ" });
    expect(back).toHaveFocus();
    await user.tab();
    expect(confirmButton()).toHaveFocus();
    await user.tab();
    expect(back).toHaveFocus();
  });

  async function cancelThenResend(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("button", { name: `ยกเลิกคำเชิญถึง ${emailOf(3)}` }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "ยืนยันการยกเลิกคำเชิญ",
      }),
    );
    await screen.findByText(`ยกเลิกคำเชิญถึง ${emailOf(3)} แล้ว`);
    await openAndConfirm(user, 1);
    await screen.findByText("ส่งคำเชิญซ้ำแล้ว");
  }

  it("keeps the resend notice when a cancel dialog is opened and dismissed with กลับ or Escape", async () => {
    serve(range(4));
    cancelRequest.mockResolvedValue({ canceled: true });
    resendRequest.mockResolvedValue(resent());
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));
    await cancelThenResend(user);

    for (const dismiss of ["back", "escape"]) {
      await user.click(
        screen.getByRole("button", { name: `ยกเลิกคำเชิญถึง ${emailOf(2)}` }),
      );
      if (dismiss === "back")
        await user.click(screen.getByRole("button", { name: "กลับ" }));
      else await user.keyboard("{Escape}");
      expect(sectionStatus()).toHaveTextContent("ส่งคำเชิญซ้ำแล้ว");
      expect(sectionStatus()).not.toHaveTextContent("ยกเลิกคำเชิญถึง");
    }
  });

  it("keeps the cancel notice when a resend dialog is opened and dismissed with กลับ or Escape", async () => {
    serve(range(4));
    cancelRequest.mockResolvedValue({ canceled: true });
    resendRequest.mockResolvedValue(resent());
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));
    // Resend first, then cancel, so the cancel notice is the current one.
    await openAndConfirm(user, 1);
    await screen.findByText("ส่งคำเชิญซ้ำแล้ว");
    await user.click(
      screen.getByRole("button", { name: `ยกเลิกคำเชิญถึง ${emailOf(3)}` }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "ยืนยันการยกเลิกคำเชิญ",
      }),
    );
    await screen.findByText(`ยกเลิกคำเชิญถึง ${emailOf(3)} แล้ว`);

    for (const dismiss of ["back", "escape"]) {
      await user.click(resendButton(2));
      if (dismiss === "back")
        await user.click(screen.getByRole("button", { name: "กลับ" }));
      else await user.keyboard("{Escape}");
      expect(sectionStatus()).toHaveTextContent(
        `ยกเลิกคำเชิญถึง ${emailOf(3)} แล้ว`,
      );
      expect(sectionStatus()).not.toHaveTextContent("ส่งคำเชิญซ้ำแล้ว");
    }
  });

  it("replaces an earlier cancel notice with the resend notice and blocks cancel buttons while it runs", async () => {
    serve(range(3));
    cancelRequest.mockResolvedValue({ canceled: true });
    resendRequest.mockResolvedValue(resent());
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(emailOf(1));

    await user.click(
      screen.getByRole("button", { name: `ยกเลิกคำเชิญถึง ${emailOf(3)}` }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "ยืนยันการยกเลิกคำเชิญ",
      }),
    );
    expect(
      await screen.findByText(`ยกเลิกคำเชิญถึง ${emailOf(3)} แล้ว`),
    ).toBeVisible();

    await openAndConfirm(user, 1);

    expect(await screen.findByText("ส่งคำเชิญซ้ำแล้ว")).toBeVisible();
    expect(sectionStatus()).not.toHaveTextContent("ยกเลิกคำเชิญถึง");
  });
});
