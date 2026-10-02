import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ActionNotice } from "./action-notice";

describe("ActionNotice", () => {
  it("keeps only the message in the live region; links and the close button sit outside it", async () => {
    const onClose = vi.fn();
    render(
      <ActionNotice
        onClose={onClose}
        actions={<a href="#files">ดูไฟล์</a>}
      >
        กำลังสร้างไฟล์
      </ActionNotice>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("กำลังสร้างไฟล์");
    expect(status).not.toContainElement(screen.getByRole("link", { name: "ดูไฟล์" }));
    const close = screen.getByRole("button", { name: "ปิดข้อความ" });
    expect(status).not.toContainElement(close);
    await userEvent.setup().click(close);
    expect(onClose).toHaveBeenCalledOnce();
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
