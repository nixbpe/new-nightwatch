import { useState, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { EyeIcon, EyeOffIcon } from "../shell/icons";
import { Input } from "./input";

// Pair it with `<Label htmlFor>`, not `<Field>`: inside a wrapping label the toggle's text would
// become part of the input's accessible name. The toggle text is inner text, not aria-label, for the
// same reason: a label containing "รหัสผ่าน" would collide with the field's own.
function PasswordInput({
  className,
  toggleTestId,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { toggleTestId?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative flex items-center">
      <Input
        type={revealed ? "text" : "password"}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        data-testid={toggleTestId}
        type="button"
        onClick={() => {
          setRevealed((value) => !value);
        }}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-md text-foreground-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
        <span className="sr-only">
          {revealed ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        </span>
      </button>
    </div>
  );
}

export { PasswordInput };
