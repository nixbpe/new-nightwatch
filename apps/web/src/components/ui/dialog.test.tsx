import { createRef, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";

afterEach(cleanup);

function Host({
  onClose = () => undefined,
  withOpener = true,
  description,
  busy,
}: {
  onClose?: () => void;
  withOpener?: boolean;
  description?: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const fallback = useRef<HTMLHeadingElement>(null);
  const second = useRef<HTMLInputElement>(null);
  return (
    <>
      <h1 data-testid="fallback" ref={fallback} tabIndex={-1}>
        fallback
      </h1>
      <button
        data-testid="open"
        type="button"
        ref={withOpener ? setOpener : undefined}
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      {open ? (
        <Dialog
          data-testid="dialog"
          title="หัวข้อ"
          titleTestId="dialog-title"
          description={description}
          descriptionTestId="dialog-description"
          busy={busy}
          opener={opener}
          fallbackFocus={fallback}
          initialFocus={second}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <input data-testid="first" aria-label="first" />
          <input data-testid="second" aria-label="second" ref={second} />
          <button data-testid="last" type="button">
            last
          </button>
          <button data-testid="disabled" type="button" disabled>
            disabled
          </button>
        </Dialog>
      ) : null}
    </>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("open"));
  return screen.getByTestId("dialog");
}

describe("Dialog", () => {
  it("names the dialog by its title and focuses the initial control", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const dialog = await open(user);
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      screen.getByTestId("dialog-title").id,
    );
    expect(screen.getByTestId("second")).toHaveFocus();
  });

  it("sets aria-describedby only when a description is passed", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host />);
    expect(await open(user)).not.toHaveAttribute("aria-describedby");
    unmount();
    render(<Host description="คำอธิบาย" />);
    const dialog = await open(user);
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("dialog-description").id,
    );
  });

  it("sets aria-busy only while busy", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host />);
    expect(await open(user)).not.toHaveAttribute("aria-busy");
    unmount();
    render(<Host busy />);
    expect(await open(user)).toHaveAttribute("aria-busy", "true");
  });

  it("wraps Tab from the last control to the first and Shift+Tab back, skipping disabled controls", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);
    screen.getByTestId("last").focus();
    await user.tab();
    expect(screen.getByTestId("first")).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("pulls focus back inside when it escapes", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await open(user);
    screen.getByTestId("fallback").focus();
    expect(screen.getByTestId("second")).toHaveFocus();
  });

  it("calls onClose on Escape and prevents the default", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const dialog = await open(user);
    const notPrevented = fireEvent.keyDown(dialog, { key: "Escape" });
    expect(notPrevented).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a scrim click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const dialog = await open(user);
    const scrim = dialog.parentElement;
    if (scrim === null) throw new Error("scrim missing");
    await user.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialog")).toBeInTheDocument();
  });

  it("returns focus to the opener on close", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const dialog = await open(user);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("open")).toHaveFocus();
  });

  it("returns focus to the fallback when there is no opener", async () => {
    const user = userEvent.setup();
    render(<Host withOpener={false} />);
    const dialog = await open(user);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByTestId("fallback")).toHaveFocus();
  });

  it("returns focus to the fallback when the opener left the page", () => {
    // A plain DOM node, so removing it does not fight React's own tree.
    const opener = document.createElement("button");
    document.body.append(opener);
    function Gone() {
      const [shown, setShown] = useState(true);
      const fallback = useRef<HTMLHeadingElement>(null);
      const initial = useRef<HTMLInputElement>(null);
      return (
        <>
          <h1 data-testid="fallback" ref={fallback} tabIndex={-1}>
            fallback
          </h1>
          {shown ? (
            <Dialog
              data-testid="dialog"
              title="t"
              opener={opener}
              fallbackFocus={fallback}
              initialFocus={initial}
              onClose={() => {
                setShown(false);
              }}
            >
              <input aria-label="x" ref={initial} />
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Gone />);
    opener.remove();
    fireEvent.keyDown(screen.getByTestId("dialog"), { key: "Escape" });
    expect(screen.queryByTestId("dialog")).toBeNull();
    expect(screen.getByTestId("fallback")).toHaveFocus();
  });

  it("exposes the panel through dialogRef", () => {
    const dialogRef = createRef<HTMLDivElement>();
    const initial = createRef<HTMLInputElement>();
    const fallback = createRef<HTMLElement>();
    render(
      <Dialog
        data-testid="dialog"
        title="t"
        opener={null}
        fallbackFocus={fallback}
        initialFocus={initial}
        dialogRef={dialogRef}
        onClose={() => undefined}
      >
        <input aria-label="x" ref={initial} />
      </Dialog>,
    );
    expect(dialogRef.current).toBe(screen.getByTestId("dialog"));
  });
});
