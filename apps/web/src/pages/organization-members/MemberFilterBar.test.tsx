import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { MemberFilterBar } from "./MemberFilterBar";

describe("MemberFilterBar", () => {
  it("drops the text filter after a member change that was saving when the box was emptied", async () => {
    const onChange = vi.fn();
    const props = {
      filter: { q: "ada" },
      searchRef: createRef<HTMLInputElement>(),
      onChange,
      onClear: vi.fn(),
    };
    const user = userEvent.setup();
    const { rerender } = render(<MemberFilterBar {...props} busy />);

    await user.clear(screen.getByTestId("members-filter-search"));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<MemberFilterBar {...props} busy={false} />);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ q: undefined });
  });
});
