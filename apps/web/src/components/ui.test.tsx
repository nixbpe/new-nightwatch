import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldValidationError } from "./ui";

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
