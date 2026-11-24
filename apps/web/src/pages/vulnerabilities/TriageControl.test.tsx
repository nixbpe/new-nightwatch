import type { Triage } from "@nightwatch/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const trigger = () => screen.getByTestId(`triage-menu-${KEY}`);
const choose = async (status: "affected" | "not-affected") => {
  await userEvent.click(trigger());
  await userEvent.click(screen.getByTestId(`triage-${status}-${KEY}`));
};

describe("TriageControl", () => {
  it("gives editors for the same finding independent accessible labels", async () => {
    renderControl({ canManage: true, triage: null });
    renderControl({ canManage: true, triage: null });
    for (const button of screen.getAllByTestId(`triage-menu-${KEY}`)) {
      await userEvent.click(button);
      await userEvent.click(screen.getByTestId(`triage-not-affected-${KEY}`));
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
    expect(screen.queryByTestId(`triage-menu-${KEY}`)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
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

  it("is one 32 px button that names the CVE and shows the current status", () => {
    renderControl({ canManage: true, triage: null });
    expect(screen.getAllByRole("button", { name: /สถานะ VEX/ })).toHaveLength(
      1,
    );
    expect(trigger()).toHaveAccessibleName(
      "สถานะ VEX ของ CVE-2026-1000: ยังไม่ triage",
    );
    expect(trigger()).toHaveTextContent("ยังไม่ triage");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the saved status on the button, keeps the reason visible and marks the current item", async () => {
    renderControl({ canManage: true, triage: triage() });
    expect(trigger()).toHaveTextContent("ไม่ได้รับผลกระทบ");
    expect(screen.getByTestId(`triage-reason-text-${KEY}`)).toHaveTextContent(
      "เหตุผล: ไม่ได้เปิดใช้ module นี้",
    );
    await userEvent.click(trigger());
    expect(
      screen.getByRole("menuitemradio", { name: "ไม่ได้รับผลกระทบ" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "ได้รับผลกระทบ" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("opens the menu on click and closes it on the button, Escape and an outside click, returning focus", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeVisible();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(trigger());
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(trigger());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();

    await userEvent.click(trigger());
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is reached by Tab and walked with the arrow keys", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.tab();
    expect(trigger()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const [first, second] = screen.getAllByRole("menuitemradio");
    expect(first).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(first).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(second).toHaveFocus();
  });

  it("draws the menu outside a scrolling container, so a table cannot clip it", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    expect(screen.getByRole("menu").parentElement).toBe(document.body);
    expect(screen.getByRole("menu").style.position).toBe("fixed");
  });

  const rectAt = (top: number, right = 400): DOMRect => ({
    left: right - 125,
    right,
    top,
    bottom: top + 32,
    width: 125,
    height: 32,
    x: right - 125,
    y: top,
    toJSON: () => ({}),
  });

  it("stays open and keeps its right edge on the moved button when the page scrolls or resizes", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    const spy = vi
      .spyOn(trigger(), "getBoundingClientRect")
      .mockReturnValue(rectAt(300, 700));
    window.dispatchEvent(new Event("scroll"));
    const menu = screen.getByRole("menu");
    await waitFor(() => {
      expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBe(
        700,
      );
    });
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(332);
    spy.mockReturnValue(rectAt(120, 400));
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => {
      expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBe(
        400,
      );
    });
    expect(screen.getByRole("menu")).toBeVisible();
    spy.mockRestore();
  });

  it("closes when its button scrolls out of view or under the sticky header", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    const spy = vi
      .spyOn(trigger(), "getBoundingClientRect")
      .mockReturnValue(rectAt(10));
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    spy.mockReturnValue(rectAt(5000));
    await userEvent.click(trigger());
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    spy.mockRestore();
  });

  it("removes its scroll and resize listeners when it closes and when it unmounts", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const count = (spy: typeof add, type: string) =>
      spy.mock.calls.filter(([name]) => name === type).length;
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    const added = count(add, "scroll");
    expect(added).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    expect(count(remove, "scroll")).toBeGreaterThanOrEqual(added);
    expect(count(remove, "resize")).toBeGreaterThanOrEqual(1);

    const before = {
      scroll: count(remove, "scroll"),
      resize: count(remove, "resize"),
    };
    await userEvent.click(trigger());
    cleanup();
    expect(count(remove, "scroll")).toBeGreaterThan(before.scroll);
    expect(count(remove, "resize")).toBeGreaterThan(before.resize);
    add.mockRestore();
    remove.mockRestore();
  });

  it("makes the items roving, not tab stops", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    for (const item of screen.getAllByRole("menuitemradio")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });

  it("closes on Tab and puts focus on the button, so the next Tab continues in page order", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    expect(screen.getAllByRole("menuitemradio")[0]).toHaveFocus();
    await userEvent.tab();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes on Shift+Tab the same way", async () => {
    renderControl({ canManage: true, triage: null });
    await userEvent.click(trigger());
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("lets an admin mark a CVE affected at once, without a reason", async () => {
    putMock.mockResolvedValue(triage({ status: "affected", reason: null }));
    const invalidate = renderControl({ canManage: true, triage: null });
    await choose("affected");
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
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu and opens the reason row for not affected, and saves it trimmed", async () => {
    putMock.mockResolvedValue(triage());
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(putMock).not.toHaveBeenCalled();
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

  it("moves focus to the reason input when not affected is chosen, with 40 px form controls", async () => {
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    const input = screen.getByTestId(`triage-reason-${KEY}`);
    expect(input).toHaveFocus();
  });

  it("names the reason field with a visible label, not only a placeholder", async () => {
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    const input = screen.getByTestId(`triage-reason-${KEY}`);
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label).not.toHaveClass("sr-only");
    expect(input).not.toHaveAttribute("placeholder");
  });

  it("closes the reason row without saving from the cancel button, and returns focus to the status button", async () => {
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    await userEvent.type(screen.getByTestId(`triage-reason-${KEY}`), "เหตุผล");
    await userEvent.click(screen.getByTestId(`triage-cancel-${KEY}`));
    expect(screen.queryByTestId(`triage-reason-${KEY}`)).toBeNull();
    expect(putMock).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
    // The next time the row opens it starts empty.
    await choose("not-affected");
    expect(screen.getByTestId(`triage-reason-${KEY}`)).toHaveValue("");
  });

  it("closes the reason row on Escape without saving", async () => {
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    await userEvent.type(screen.getByTestId(`triage-reason-${KEY}`), "เหตุผล");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId(`triage-reason-${KEY}`)).toBeNull();
    expect(putMock).not.toHaveBeenCalled();
    expect(trigger()).toHaveFocus();
  });

  it("keeps a whitespace-only reason from being saved", async () => {
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    await userEvent.type(screen.getByTestId(`triage-reason-${KEY}`), "   ");
    expect(screen.getByTestId(`triage-save-${KEY}`)).toBeDisabled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("says why a save failed and keeps what the person typed", async () => {
    putMock.mockRejectedValue(
      new ApiError("VULNERABILITY_FINDING_NOT_FOUND", "x", 404),
    );
    renderControl({ canManage: true, triage: null });
    await choose("not-affected");
    await userEvent.type(screen.getByTestId(`triage-reason-${KEY}`), "เหตุผล");
    await userEvent.click(screen.getByTestId(`triage-save-${KEY}`));
    expect(await screen.findByTestId(`triage-error-${KEY}`)).toHaveTextContent(
      "ไม่พบ CVE นี้ในผลล่าสุดแล้ว",
    );
    expect(screen.getByTestId(`triage-reason-${KEY}`)).toHaveValue("เหตุผล");
  });

  it.each(["cancel", "Escape"] as const)(
    "keeps one request pending after %s and retries the retained justification after rejection",
    async (dismiss) => {
      let reject!: (error: Error) => void;
      putMock.mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail;
        }),
      );
      const invalidate = renderControl({ canManage: true, triage: null });
      await choose("not-affected");
      const input = screen.getByTestId(`triage-reason-${KEY}`);
      await userEvent.type(input, "  module disabled  ");
      await userEvent.click(screen.getByTestId(`triage-save-${KEY}`));
      if (dismiss === "cancel") {
        await userEvent.click(screen.getByTestId(`triage-cancel-${KEY}`));
      } else {
        await userEvent.click(input);
        await userEvent.keyboard("{Escape}");
      }
      await userEvent.click(trigger());
      const alternative = screen.queryByTestId(`triage-affected-${KEY}`);
      if (alternative) await userEvent.click(alternative);
      expect(putMock).toHaveBeenCalledTimes(1);
      expect(putMock).toHaveBeenLastCalledWith(ORG, PROJECT, {
        ...target,
        status: "not_affected",
        reason: "module disabled",
      });
      expect(trigger()).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByTestId(`triage-cancel-${KEY}`)).toBeDisabled();
      expect(screen.getByTestId(`triage-save-${KEY}`)).toBeDisabled();
      expect(input.closest("form")).toHaveAttribute("aria-busy", "true");
      expect(input).toHaveValue("  module disabled  ");
      // Enter is another submit path, not just a click on the disabled Save.
      await userEvent.click(input);
      await userEvent.keyboard("{Enter}");
      await userEvent.click(document.body);
      expect(putMock).toHaveBeenCalledTimes(1);
      reject(new ApiError("X", "x", 500));
      await screen.findByTestId(`triage-error-${KEY}`);
      expect(invalidate).not.toHaveBeenCalled();
      expect(input.closest("form")).toHaveAttribute("aria-busy", "false");
      expect(input).toHaveValue("  module disabled  ");
      expect(screen.getByTestId(`triage-save-${KEY}`)).toBeEnabled();
      putMock.mockResolvedValueOnce(triage());
      await userEvent.click(screen.getByTestId(`triage-save-${KEY}`));
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledTimes(1);
      });
      expect(putMock).toHaveBeenCalledTimes(2);
      expect(putMock).toHaveBeenLastCalledWith(ORG, PROJECT, {
        ...target,
        status: "not_affected",
        reason: "module disabled",
      });
      expect(screen.queryByTestId(`triage-reason-${KEY}`)).toBeNull();
      await choose("not-affected");
      expect(screen.getByTestId(`triage-reason-${KEY}`)).toHaveValue("");
    },
  );

  it("announces the save as it runs and when it is done", async () => {
    let finish: (value: Triage) => void = () => undefined;
    putMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderControl({ canManage: true, triage: null });
    await choose("affected");
    expect(await screen.findByText("กำลังบันทึกสถานะ VEX")).toBeInTheDocument();
    // aria-disabled, not disabled: the button keeps focus while it saves.
    expect(trigger()).toHaveAttribute("aria-disabled", "true");
    expect(trigger()).toHaveFocus();
    await userEvent.click(trigger());
    expect(screen.queryByRole("menu")).toBeNull();
    finish(triage({ status: "affected", reason: null }));
    expect(await screen.findByText("บันทึกสถานะ VEX แล้ว")).toBeInTheDocument();
  });
});
