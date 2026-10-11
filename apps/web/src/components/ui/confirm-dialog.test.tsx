import { createRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

/**
 * A dialog with a link, an input and the two buttons, so the Tab trap can be
 * checked across every focusable type a real caller's description may hold.
 */
function StaticDialog() {
  const fallback = createRef<HTMLHeadingElement>();
  return (
    <>
      <h1 data-testid="confirmation-fallback" ref={fallback} tabIndex={-1}>
        fallback heading
      </h1>
      <ConfirmDialog
        data-testid="confirmation-dialog"
        confirmTestId="confirmation-confirm"
        title="ยืนยัน"
        description={
          <>
            <a data-testid="confirmation-details" href="#more">
              รายละเอียด
            </a>
            <input data-testid="confirmation-reason" aria-label="เหตุผล" />
          </>
        }
        confirmLabel="ตกลง"
        confirmVariant="destructive"
        pendingLabel="กำลังทำ…"
        pending={false}
        opener={null}
        fallbackFocus={fallback}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    </>
  );
}

/**
 * A host that owns open/pending state the way a real caller does: the opener
 * button mounts the dialog, Confirm drives it pending, and Cancel/Escape
 * unmount it so the dialog's own cleanup effect can move focus.
 */
function StatefulHost({ withOpener = true }: { withOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const fallback = createRef<HTMLHeadingElement>();
  return (
    <>
      <h1 data-testid="confirmation-fallback" ref={fallback} tabIndex={-1}>
        fallback heading
      </h1>
      <button
        data-testid="confirmation-open"
        type="button"
        ref={withOpener ? setOpener : undefined}
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      {open && (
        <ConfirmDialog
          data-testid="confirmation-dialog"
          confirmTestId="confirmation-confirm"
          title="ยืนยัน"
          description="รายละเอียด"
          confirmLabel="ตกลง"
          pendingLabel="กำลังทำ…"
          pending={pending}
          opener={opener}
          fallbackFocus={fallback}
          onCancel={() => {
            setOpen(false);
          }}
          onConfirm={() => {
            setPending(true);
          }}
        />
      )}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("focuses Cancel on open", () => {
    render(<StaticDialog />);
    expect(screen.getByTestId("confirmation-dialog")).toHaveAttribute(
      "role",
      "dialog",
    );
    expect(screen.getByTestId("confirmation-dialog")).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByTestId("confirmation-cancel")).toHaveFocus();
  });

  it("traps Tab across links, inputs and buttons in both directions", async () => {
    const user = userEvent.setup();
    render(<StaticDialog />);
    const link = screen.getByTestId("confirmation-details");
    const input = screen.getByTestId("confirmation-reason");
    const confirm = screen.getByTestId("confirmation-confirm");
    // DOM order is link, input, Cancel, confirm; initial focus is Cancel.
    expect(screen.getByTestId("confirmation-cancel")).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(link).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    // Shift+Tab from the first focusable wraps to the last.
    link.focus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener when not pending", async () => {
    const user = userEvent.setup();
    render(<StatefulHost />);
    const opener = screen.getByTestId("confirmation-open");
    await user.click(opener);
    expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("confirmation-dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("ignores Escape and keeps focus in the dialog while pending", async () => {
    const user = userEvent.setup();
    render(<StatefulHost />);
    await user.click(screen.getByTestId("confirmation-open"));
    // The focused Confirm button is disabled once pending; focus moves to the dialog itself.
    await user.click(screen.getByTestId("confirmation-confirm"));
    const dialog = screen.getByTestId("confirmation-dialog");
    expect(dialog).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("confirmation-dialog")).toBeInTheDocument();
    expect(dialog).toHaveFocus();
  });

  it("returns focus to fallbackFocus when the opener is gone", async () => {
    const user = userEvent.setup();
    render(<StatefulHost withOpener={false} />);
    await user.click(screen.getByTestId("confirmation-open"));
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("confirmation-fallback")).toHaveFocus();
  });
});
