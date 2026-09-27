import { ShieldIcon } from "./icons";

export function BrandMark({
  size = 32,
  withName = false,
}: {
  size?: number;
  withName?: boolean;
}) {
  const mark = (
    <span
      aria-hidden={withName ? true : undefined}
      role={withName ? undefined : "img"}
      aria-label={withName ? undefined : "NightWatch"}
      className="inline-flex flex-shrink-0 items-center justify-center rounded-md bg-primary text-on-primary"
      style={{ width: size, height: size }}
    >
      <ShieldIcon size={Math.round(size * 0.55)} />
    </span>
  );
  if (!withName) {
    return mark;
  }
  return (
    <span className="inline-flex items-center gap-2.5">
      {mark}
      <span className={`font-semibold ${size >= 36 ? "text-lg" : "text-base"}`}>
        NightWatch
      </span>
    </span>
  );
}
