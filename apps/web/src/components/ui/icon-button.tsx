import type { ComponentProps, ReactNode } from "react";

import { InfoIcon } from "../shell/icons";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

/** An icon-only button. `label` is both its accessible name and its tooltip, so they never differ. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "children" | "size"> & {
  label: string;
  icon: ReactNode;
  /** 32 px for row and page actions (LAY-06); 40 px beside form controls. */
  size?: "icon" | "icon-sm";
}) {
  return (
    <Tooltip label={label}>
      <Button
        type="button"
        size={size}
        variant={variant}
        aria-label={label}
        {...props}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

/** An explanation kept off the page: an info icon whose tooltip, and `aria-label`, carry the text. */
export function InfoTip({
  label,
  "data-testid": testId,
}: {
  label: string;
  "data-testid"?: string;
}) {
  return (
    <Tooltip label={label} wide>
      <button
        type="button"
        data-testid={testId}
        aria-label={label}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <InfoIcon />
      </button>
    </Tooltip>
  );
}
