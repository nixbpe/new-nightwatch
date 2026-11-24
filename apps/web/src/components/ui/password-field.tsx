import type { ReactNode } from "react";

import { FieldValidationError } from "../ui";
import { Label } from "./label";
import { PasswordInput } from "./password-input";

export function PasswordField({
  id,
  testId = id,
  label,
  name,
  autoComplete,
  autoFocus,
  value,
  onChange,
  onBlur,
  errors,
  serverError = null,
}: {
  id: string;
  testId?: string;
  label: ReactNode;
  name?: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  errors: readonly unknown[];
  serverError?: string | null;
}) {
  const invalid = errors.length > 0 || serverError !== null;
  const errorId = `${id}-error`;
  const errorTestId = `${testId}-error`;
  return (
    <div>
      <Label htmlFor={id} className="mb-2 block">
        {label}
      </Label>
      <PasswordInput
        data-testid={testId}
        toggleTestId={`${testId}-toggle`}
        id={id}
        name={name}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
      />
      {serverError === null ? (
        <FieldValidationError
          data-testid={errorTestId}
          id={errorId}
          errors={errors}
        />
      ) : (
        <span
          data-testid={errorTestId}
          id={errorId}
          role="alert"
          className="mt-1 block text-sm text-danger"
        >
          {serverError}
        </span>
      )}
    </div>
  );
}
