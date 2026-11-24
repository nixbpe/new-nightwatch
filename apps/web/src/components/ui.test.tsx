import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert, FieldValidationError } from "./ui";

describe("FieldValidationError", () => {
  it.each([
    ["string", ["invalid email", "later"], "invalid email"],
    ["message object", [{ message: "invalid name" }, "later"], "invalid name"],
    ["empty string", ["", "later"], ""],
    ["empty message object", [{ message: "" }, "later"], ""],
  ])(
    "renders the first %s with its error linkage",
    (_name, errors, expected) => {
      render(
        <FieldValidationError
          id="email-error"
          data-testid="field-error"
          errors={errors}
        />,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toBe(screen.getByTestId("field-error"));
      expect(alert).toHaveAttribute("id", "email-error");
      expect(alert.textContent).toBe(expected);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    },
  );

  it.each([
    [],
    [undefined, "later"],
    [null, { message: "later" }],
    [42, "later"],
    [{}, "later"],
    [{ message: 42 }, "later"],
  ])(
    "does not select a later error after invalid first value %j",
    (...errors) => {
      render(<FieldValidationError id="email-error" errors={errors} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});

describe("Alert", () => {
  it.each([
    ["error", "alert"],
    ["warning", "status"],
    ["info", "status"],
  ] as const)("announces a %s alert as role %s by default", (tone, role) => {
    render(
      <Alert data-testid="banner" tone={tone}>
        text
      </Alert>,
    );
    expect(screen.getByTestId("banner")).toHaveAttribute("role", role);
  });

  it("lets a caller raise a warning to role alert", () => {
    render(
      <Alert data-testid="banner" tone="warning" role="alert">
        text
      </Alert>,
    );
    expect(screen.getByTestId("banner")).toHaveAttribute("role", "alert");
  });

  it.each(["error", "warning", "info"] as const)(
    "pairs a %s alert with a hidden icon beside its text",
    (tone) => {
      render(
        <Alert data-testid="banner" tone={tone}>
          text
        </Alert>,
      );
      const banner = screen.getByTestId("banner");
      expect(banner.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      expect(banner).toHaveTextContent("text");
    },
  );
});
