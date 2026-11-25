import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert, Field, FieldValidationError, Input } from "./ui";

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

describe("Field", () => {
  it("names a wrapped control by the label alone and keeps help and error outside it", () => {
    render(
      <Field
        label="ชื่อ"
        help="ชื่อที่แสดง"
        helpId="name-help"
        error="กรอกชื่อ"
        errorId="name-error"
      >
        <Input aria-describedby="name-help name-error" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "ชื่อ" });
    expect(input).toHaveAccessibleDescription("ชื่อที่แสดง กรอกชื่อ");
  });

  it("puts the error directly under the control and the help after it", () => {
    render(
      <>
        <Field label="ชื่อ" help="ชื่อที่แสดง" error="กรอกชื่อ">
          <Input />
        </Field>
        <Field
          label="โซนเวลา"
          htmlFor="zone"
          help="ใช้กับรายงาน"
          error="เลือกโซนเวลา"
        >
          <Input id="zone" />
        </Field>
      </>,
    );
    for (const [error, help] of [
      ["กรอกชื่อ", "ชื่อที่แสดง"],
      ["เลือกโซนเวลา", "ใช้กับรายงาน"],
    ] as const) {
      expect(
        screen
          .getByText(error)
          .compareDocumentPosition(screen.getByText(help)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("pairs the label by htmlFor for a control that cannot sit inside a label", () => {
    render(
      <Field
        label="โซนเวลา"
        htmlFor="zone"
        help="ใช้กับรายงาน"
        helpId="zone-help"
      >
        <Input id="zone" aria-describedby="zone-help" />
      </Field>,
    );
    expect(screen.getByLabelText("โซนเวลา")).toHaveAccessibleDescription(
      "ใช้กับรายงาน",
    );
  });
});
