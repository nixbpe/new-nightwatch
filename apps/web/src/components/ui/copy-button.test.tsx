import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from "./copy-button";

const LABEL = "copy the code";

function setup(showLabel = false) {
  const user = userEvent.setup();
  render(
    <CopyButton
      value="abc-123"
      label={LABEL}
      copiedLabel="copied"
      showLabel={showLabel}
      data-testid="copy"
    />,
  );
  return user;
}

describe("CopyButton", () => {
  it("names what it copies and shows a visible confirmation after the write", async () => {
    const user = setup();
    expect(screen.getByTestId("copy")).toHaveAccessibleName(LABEL);
    expect(screen.getByTestId("copy-status")).toHaveAttribute(
      "data-status",
      "idle",
    );
    await user.click(screen.getByTestId("copy"));
    expect(await navigator.clipboard.readText()).toBe("abc-123");
    await waitFor(() => {
      expect(screen.getByTestId("copy-status")).toHaveAttribute(
        "data-status",
        "copied",
      );
    });
    // The shared success form (CMP-10), drawn on the page.
    expect(
      screen.getByTestId("copy-status").querySelector('[data-slot="notice"]'),
    ).toHaveTextContent("copied");
  });

  it("reports a refused clipboard write instead of staying silent", async () => {
    const user = setup(true);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
      new Error("denied"),
    );
    await user.click(screen.getByTestId("copy"));
    await waitFor(() => {
      expect(screen.getByTestId("copy-status")).toHaveAttribute(
        "data-status",
        "failed",
      );
    });
    expect(screen.getByTestId("copy-status")).not.toBeEmptyDOMElement();
  });
});
