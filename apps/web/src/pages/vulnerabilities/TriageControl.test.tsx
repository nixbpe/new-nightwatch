import type { Triage } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api/client";
import { putTriage } from "../../lib/api/vulnerabilities";
import { TriageControl } from "./TriageControl";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAPPING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const target = { mappingId: MAPPING, version: "7.2.4", cveId: "CVE-2026-1000" };
const KEY = `${target.cveId}-${MAPPING}-${target.version}`;

vi.mock("../../lib/api/vulnerabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  putTriage: vi.fn(),
}));
const putMock = vi.mocked(putTriage);

const triage = (over: Partial<Triage> = {}): Triage => ({
  status: "not_affected",
  reason: "ไม่ได้เปิดใช้ module นี้",
  changedBy: "Somchai",
  changedAt: "2026-11-20T09:00:00.000Z",
  ...over,
});

function renderControl(props: { canManage: boolean; triage: Triage | null }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <TriageControl
        organizationId={ORG}
        projectId={PROJECT}
        target={target}
        {...props}
      />
    </QueryClientProvider>,
  );
  return invalidate;
}

beforeEach(() => {
  putMock.mockReset();
});

describe("TriageControl", () => {
  it("gives editors for the same finding independent accessible labels", async () => {
    renderControl({ canManage: true, triage: null });
    renderControl({ canManage: true, triage: null });
    for (const button of screen.getAllByTestId(`triage-not-affected-${KEY}`)) {
      await userEvent.click(button);
    }
    const editors = screen.getAllByTestId(`triage-reason-${KEY}`);
    expect(editors).toHaveLength(2);
    expect(new Set(editors.map((editor) => editor.id)).size).toBe(2);
    for (const editor of editors) expect(editor).toHaveAccessibleName();
  });
  it("says untriaged until a person decides, and gives a member no way to decide", () => {
    renderControl({ canManage: false, triage: null });
    expect(screen.getByTestId(`triage-${KEY}`)).toHaveTextContent(
      "ยังไม่ triage",
    );
    expect(screen.queryByTestId(`triage-affected-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`triage-not-affected-${KEY}`)).toBeNull();
  });

  it("shows the status with the reason, and who set it and when only in a tooltip", async () => {
    renderControl({ canManage: false, triage: triage() });
    const text = screen.getByTestId(`triage-status-${KEY}`);
    expect(text).toHaveTextContent(
      "ไม่ได้รับผลกระทบ: ไม่ได้เปิดใช้ module นี้",
    );
    expect(text).not.toHaveTextContent("Somchai");
    const tip = screen.getByTestId(`triage-by-${KEY}`);
    expect(tip.getAttribute("aria-label")).toMatch(/^ตั้งโดย Somchai เมื่อ /);
    await userEvent.hover(tip);
    expect(await screen.findByTestId("tooltip")).toHaveTextContent(
      tip.getAttribute("aria-label") ?? "",
    );
  });

  it("says unknown when the person who set it is no longer known", () => {
    renderControl({ canManage: false, triage: triage({ changedBy: null }) });
    expect(
      screen.getByTestId(`triage-by-${KEY}`).getAttribute("aria-label"),
    ).toContain("ไม่ทราบผู้ทำรายการ");
  });

  it("is one two-segment control that the keyboard reaches even before a status is set", async () => {
    renderControl({ canManage: true, triage: null });
    const group = screen.getByRole("group", {
      name: "สถานะ VEX ของ CVE-2026-1000",
    });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "ได้รับผลกระทบ",
      "ไม่ได้รับผลกระทบ",
    ]);
    await userEvent.tab();
    expect(buttons[0]).toHaveFocus();
    await userEvent.tab();
    expect(buttons[1]).toHaveFocus();
    // Opening the reason row selects nothing until it is saved.
    await userEvent.keyboard("{Enter}");
    expect(buttons[1]).toHaveAttribute("aria-expanded", "true");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the current status as pressed", () => {
    renderControl({ canManage: true, triage: triage() });
    expect(screen.getByTestId(`triage-not-affected-${KEY}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId(`triage-affected-${KEY}`)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("announces the save as it runs and when it is done", async () => {
    let finish: (value: Triage) => void = () => undefined;
    putMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderControl({ canManage: true, triage: null });
    await userEvent.click(screen.getByTestId(`triage-affected-${KEY}`));
    expect(await screen.findByText("กำลังบันทึกสถานะ VEX")).toBeInTheDocument();
    finish(triage({ status: "affected", reason: null }));
    expect(await screen.findByText("บันทึกสถานะ VEX แล้ว")).toBeInTheDocument();
  });

  it("lets an admin mark a CVE affected at once, without a reason", async () => {
    putMock.mockResolvedValue(triage({ status: "affected", reason: null }));
    const invalidate = renderControl({ canManage: true, triage: null });
    await userEvent.click(screen.getByTestId(`triage-affected-${KEY}`));
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith(ORG, PROJECT, {
        ...target,
        status: "affected",
        reason: null,
      });
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("asks for a reason before marking not affected, and saves it trimmed", async () => {
    putMock.mockResolvedValue(triage());
    renderControl({ canManage: true, triage: null });
    await userEvent.click(screen.getByTestId(`triage-not-affected-${KEY}`));
    const save = screen.getByTestId(`triage-save-${KEY}`);
    expect(save).toBeDisabled();
    await userEvent.type(
      screen.getByTestId(`triage-reason-${KEY}`),
      "  ไม่ได้ใช้  ",
    );
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith(ORG, PROJECT, {
        ...target,
        status: "not_affected",
        reason: "ไม่ได้ใช้",
      });
    });
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a whitespace-only reason from being saved", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(screen.getByTestId(`triage-not-affected-${KEY}`));
    await userEvent.type(screen.getByTestId(`triage-reason-${KEY}`), "   ");
    expect(screen.getByTestId(`triage-save-${KEY}`)).toBeDisabled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("says why a save failed and keeps what the person typed", async () => {
    putMock.mockRejectedValue(
      new ApiError("VULNERABILITY_FINDING_NOT_FOUND", "x", 404),
    );
    renderControl({ canManage: true, triage: null });
    await userEvent.click(screen.getByTestId(`triage-not-affected-${KEY}`));
    await userEvent.type(screen.getByTestId(`triage-reason-${KEY}`), "เหตุผล");
    await userEvent.click(screen.getByTestId(`triage-save-${KEY}`));
    expect(await screen.findByTestId(`triage-error-${KEY}`)).toHaveTextContent(
      "ไม่พบ CVE นี้ในผลล่าสุดแล้ว",
    );
    expect(screen.getByTestId(`triage-reason-${KEY}`)).toHaveValue("เหตุผล");
  });
});
