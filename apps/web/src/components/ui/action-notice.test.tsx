import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActionNotice } from "./action-notice";

describe("ActionNotice", () => {
  it("keeps only the message in the live region; links and the close button sit outside it", async () => {
    const onClose = vi.fn();
    render(
      <ActionNotice onClose={onClose} actions={<a href="#files">ดูไฟล์</a>}>
        กำลังสร้างไฟล์
      </ActionNotice>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("กำลังสร้างไฟล์");
    expect(status).not.toContainElement(
      screen.getByRole("link", { name: "ดูไฟล์" }),
    );
    const close = screen.getByRole("button", { name: "ปิดข้อความ" });
    expect(status).not.toContainElement(close);
    await userEvent.setup().click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("mounts the live region empty and fills it after mount so it is announced", () => {
    const first = renderToStaticMarkup(
      <ActionNotice>กำลังสร้างไฟล์</ActionNotice>,
    );
    expect(first).toContain('role="status"');
    expect(first).not.toContain("กำลังสร้างไฟล์");
    render(<ActionNotice>กำลังสร้างไฟล์</ActionNotice>);
    expect(screen.getByRole("status")).toHaveTextContent("กำลังสร้างไฟล์");
  });

  it("carries no live region when the page announces the message itself", () => {
    render(<ActionNotice live={false}>กำลังสร้างไฟล์</ActionNotice>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("กำลังสร้างไฟล์")).toBeInTheDocument();
  });

  it("takes focus from code only when focusable", () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(
      <ActionNotice ref={ref} focusable>
        สิทธิ์เปลี่ยน
      </ActionNotice>,
    );
    expect(ref.current).toHaveAttribute("tabindex", "-1");
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
    rerender(<ActionNotice ref={ref}>สิทธิ์เปลี่ยน</ActionNotice>);
    expect(ref.current).not.toHaveAttribute("tabindex");
  });

  it("offers no close button unless asked and no success tone", () => {
    render(<ActionNotice>ข้อความ</ActionNotice>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status").className).not.toContain("text-primary");
  });
});
