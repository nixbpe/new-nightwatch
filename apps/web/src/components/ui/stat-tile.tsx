import { cn } from "@/lib/utils";

/** Cell padding and rhythm shared by every stat tile; the caller adds the wrapper (div or link). */
export const STAT_TILE_CLASS = "flex flex-col gap-2.5 px-6 py-[22px]";

/**
 * Dot, Thai label and mono number: the one stat pattern of Workspace and the
 * monitor list. Returns the cell's content only. With `term`, the label is a
 * `dt` and the number a `dd`, so the caller's wrapper must be a `div` inside a `dl`.
 */
export function StatTile({
  dot,
  label,
  value,
  total,
  note,
  term = false,
}: {
  /** Background class of the 7 px dot, e.g. `bg-danger`. */
  dot: string;
  label: string;
  value: number;
  total?: number;
  note?: string;
  term?: boolean;
}) {
  const Label = term ? "dt" : "span";
  const Value = term ? "dd" : "span";
  const Note = term ? "dd" : "span";
  return (
    <>
      <Label className="flex items-center gap-2 text-[13px] font-medium">
        <span
          aria-hidden="true"
          className={cn("size-[7px] shrink-0 rounded-full", dot)}
        />
        {label}
      </Label>
      <Value className="flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-[40px] leading-none font-medium text-heading">
          {value}
        </span>
        {total === undefined ? null : (
          <span className="text-[13px] text-foreground-secondary">
            / {total}
          </span>
        )}
      </Value>
      {note === undefined || note === "" ? null : (
        <Note className="text-[13px] text-foreground-secondary">{note}</Note>
      )}
    </>
  );
}
