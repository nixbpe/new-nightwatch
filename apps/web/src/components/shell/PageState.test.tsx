import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageState } from "./PageState";

describe("PageState inline loading", () => {
  it("announces the label and marks the block busy", () => {
    render(
      <PageState
        kind="loading"
        layout="inline"
        data-testid="block"
        statusTestId="block-status"
        label="loading block"
      />,
    );
    const status = screen.getByTestId("block-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAccessibleName("loading block");
    expect(screen.getByTestId("block")).toHaveAttribute("aria-busy", "true");
  });
});
