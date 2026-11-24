import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { Input } from "./input";

const OTP_LENGTH = 6;

// One TOTP field for sign-in and enrolment. Digits only and capped in `onValueChange`, not with
// `maxLength`: the browser would cut a pasted "123 456" to "123 45" before we could strip the space.
function OtpCodeInput({
  onValueChange,
  className,
  ...props
}: Omit<
  ComponentProps<"input">,
  | "type"
  | "inputMode"
  | "autoComplete"
  | "maxLength"
  | "placeholder"
  | "onChange"
> & { onValueChange: (value: string) => void }) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="000000"
      // The page or step exists for this one field.
      autoFocus
      onChange={(event) => {
        onValueChange(
          event.target.value.replace(/[^0-9]/g, "").slice(0, OTP_LENGTH),
        );
      }}
      className={cn(
        "max-w-56 text-center font-mono text-xl tracking-normal sm:text-2xl sm:tracking-[0.35em]",
        className,
      )}
      {...props}
    />
  );
}

export { OtpCodeInput };
