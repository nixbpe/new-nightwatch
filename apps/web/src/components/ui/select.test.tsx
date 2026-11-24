import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "./select";

afterEach(cleanup);

function Options() {
  return (
    <>
      <option value="a">A</option>
      <option value="b">B</option>
    </>
  );
}

describe("Select", () => {
  it("renders a native select that reports the chosen value", async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="role" defaultValue="a" onChange={onChange}>
        <Options />
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "role" });
    expect(select.tagName).toBe("SELECT");
    await userEvent.selectOptions(select, "b");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((select as HTMLSelectElement).value).toBe("b");
  });

  it("forwards the ref, native attributes and aria-invalid", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select
        ref={ref}
        aria-label="role"
        data-testid="role"
        aria-invalid
        aria-describedby="role-error"
        name="role"
      >
        <Options />
      </Select>,
    );
    const select = screen.getByTestId("role");
    expect(ref.current).toBe(select);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe("role-error");
    expect(select.getAttribute("name")).toBe("role");
  });

  it("is disabled through the native attribute", () => {
    render(
      <Select aria-label="role" disabled>
        <Options />
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "role" });
    expect((select as HTMLSelectElement).disabled).toBe(true);
  });

  it("does not pass its size prop to the native size attribute", () => {
    render(
      <Select aria-label="role" size="sm">
        <Options />
      </Select>,
    );
    expect(
      screen.getByRole("combobox", { name: "role" }).getAttribute("size"),
    ).toBeNull();
  });
});
