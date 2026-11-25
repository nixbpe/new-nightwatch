import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox";
import { Dialog } from "./dialog";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "Asia/Bangkok (GMT+7)" },
  { value: "b", label: "Asia/Tokyo (GMT+9)" },
  { value: "c", label: "Europe/Paris (GMT+1)" },
];

function Harness({ initial = "a" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Combobox
        aria-label="zone"
        options={OPTIONS}
        value={value}
        onValueChange={setValue}
        emptyText={(q) => `none: ${q}`}
      />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

describe("Combobox", () => {
  it("shows the chosen label and opens the full list on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByRole("combobox", { name: "zone" });
    expect(field).toHaveValue("Asia/Bangkok (GMT+7)");
    expect(field).toHaveAttribute("aria-expanded", "false");
    await user.click(field);
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Bangkok",
    );
  });

  it("filters by every typed word and reports an empty result", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("asia +9");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.clear(screen.getByRole("combobox"));
    await user.keyboard("nope");
    expect(screen.getByText("none: nope")).toBeVisible();
  });

  it("chooses with the keyboard and restores the label on Escape or blur", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByRole("combobox");
    await user.click(field);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("chosen")).toHaveTextContent("b");
    expect(field).toHaveValue("Asia/Tokyo (GMT+9)");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(field);
    await user.keyboard("par{Escape}");
    expect(screen.getByTestId("chosen")).toHaveTextContent("b");
    expect(field).toHaveValue("Asia/Tokyo (GMT+9)");

    await user.keyboard("{ArrowDown}par");
    await user.tab();
    expect(field).toHaveValue("Asia/Tokyo (GMT+9)");
  });

  it("chooses an option with the pointer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Paris/ }));
    expect(screen.getByTestId("chosen")).toHaveTextContent("c");
  });

  it("names the listbox through aria-labelledby", async () => {
    const user = userEvent.setup();
    render(
      <>
        <span id="zone-label">โซนเวลา</span>
        <Combobox
          aria-labelledby="zone-label"
          options={OPTIONS}
          value="a"
          onValueChange={() => undefined}
          emptyText={() => ""}
        />
      </>,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox", { name: "โซนเวลา" })).toBeVisible();
  });

  it("closes only the list on the first Escape inside a dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function InDialog() {
      const field = useRef<HTMLInputElement>(null);
      const fallback = useRef<HTMLElement>(null);
      return (
        <Dialog
          title="t"
          opener={null}
          fallbackFocus={fallback}
          initialFocus={field}
          onClose={onClose}
        >
          <Combobox
            ref={field}
            aria-label="zone"
            options={OPTIONS}
            value="a"
            onValueChange={() => undefined}
            emptyText={() => ""}
          />
        </Dialog>
      );
    }
    render(<InDialog />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
