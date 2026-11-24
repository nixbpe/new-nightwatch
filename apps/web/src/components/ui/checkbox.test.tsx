import { createRef, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

afterEach(cleanup);

function Host() {
  const [checked, setChecked] = useState(false);
  return (
    <label>
      accept
      <Checkbox
        checked={checked}
        onChange={(event) => {
          setChecked(event.target.checked);
        }}
      />
    </label>
  );
}

describe("Checkbox", () => {
  it("toggles through its label and the keyboard", async () => {
    render(<Host />);
    const box = screen.getByRole("checkbox", { name: "accept" });
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByText("accept"));
    expect((box as HTMLInputElement).checked).toBe(true);
    box.focus();
    await userEvent.keyboard(" ");
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it("forwards the ref and native attributes", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Checkbox
        ref={ref}
        data-testid="box"
        aria-label="box"
        aria-describedby="note"
        disabled
      />,
    );
    const box = screen.getByTestId("box");
    expect(ref.current).toBe(box);
    expect(box.getAttribute("type")).toBe("checkbox");
    expect(box.getAttribute("aria-describedby")).toBe("note");
    expect((box as HTMLInputElement).disabled).toBe(true);
  });
});
