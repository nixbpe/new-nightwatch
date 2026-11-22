import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IconButton, InfoTip } from "./icon-button";

describe("Tooltip", () => {
  it("opens on hover and closes when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<IconButton label="แก้แถว Ubuntu 22.04.4" icon={<i />} />);
    const button = screen.getByRole("button", {
      name: "แก้แถว Ubuntu 22.04.4",
    });

    expect(screen.queryByTestId("tooltip")).toBeNull();
    await user.hover(button);
    expect(screen.getByTestId("tooltip")).toHaveTextContent(
      "แก้แถว Ubuntu 22.04.4",
    );
    await user.unhover(button);
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("stays open while the pointer is on the bubble itself", async () => {
    const user = userEvent.setup();
    render(<IconButton label="ลบแถว" icon={<i />} />);
    const button = screen.getByRole("button", { name: "ลบแถว" });

    await user.hover(button);
    const bubble = screen.getByTestId("tooltip");
    // A browser reports the move from the button to the bubble with the element it went to.
    fireEvent.mouseOut(button, { relatedTarget: bubble });
    fireEvent.mouseOver(bubble, { relatedTarget: button });
    expect(screen.getByTestId("tooltip")).toBeInTheDocument();
    fireEvent.mouseOut(bubble, { relatedTarget: document.body });
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("opens when the control takes focus with Tab and closes when focus leaves", async () => {
    const user = userEvent.setup();
    render(
      <>
        <IconButton label="ลบแถว" icon={<i />} />
        <button type="button">ถัดไป</button>
      </>,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "ลบแถว" })).toHaveFocus();
    expect(screen.getByTestId("tooltip")).toHaveTextContent("ลบแถว");
    await user.tab();
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("opens on a touch and closes on a touch elsewhere", () => {
    render(
      <>
        <InfoTip label="key คือ System + Vendor + Product + Version" />
        <p data-testid="elsewhere">x</p>
      </>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /^key คือ/ }), {
      pointerType: "touch",
    });
    expect(screen.getByTestId("tooltip")).toHaveTextContent("key คือ");
    fireEvent.pointerDown(screen.getByTestId("elsewhere"), {
      pointerType: "touch",
    });
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("closes on Escape without passing that key to a dialog around it", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === "Escape") outer();
        }}
      >
        <IconButton label="ค้นหา" icon={<i />} />
      </div>,
    );

    await user.tab();
    expect(screen.getByTestId("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("tooltip")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("gives an icon button and an info icon the same text as tooltip and accessible name", async () => {
    const user = userEvent.setup();
    render(
      <>
        <IconButton label="หน้าถัดไป" icon={<i />} />
        <InfoTip label="คำอธิบาย" />
      </>,
    );

    for (const name of ["หน้าถัดไป", "คำอธิบาย"]) {
      const control = screen.getByRole("button", { name });
      await user.hover(control);
      expect(screen.getByTestId("tooltip")).toHaveTextContent(name);
      expect(control).toHaveAttribute("aria-label", name);
      await user.unhover(control);
    }
  });
});
