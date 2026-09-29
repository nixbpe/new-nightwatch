const MASK = "•••";
export const ACTUAL_MAX_CHARS = 200;

/**
 * Replaces every secret value, its JSON-escaped and URL-encoded forms, and the
 * base64 of a Basic credential. Longest first so a secret containing another
 * is masked whole.
 */
export function createRedactor(
  secretValues: readonly string[],
  extra: readonly string[] = [],
): (text: string) => string {
  const needles = new Set<string>();
  for (const value of [...secretValues, ...extra]) {
    if (value === "") continue;
    needles.add(value);
    needles.add(JSON.stringify(value).slice(1, -1));
    needles.add(encodeURIComponent(value));
  }
  const ordered = [...needles]
    .filter((needle) => needle !== "")
    .sort((a, b) => b.length - a.length);
  return (text) =>
    ordered.reduce((acc, needle) => acc.split(needle).join(MASK), text);
}

/** Cuts by code point so a surrogate pair is never split. */
export function truncateActual(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= ACTUAL_MAX_CHARS) return { text, truncated: false };
  const points = Array.from(text);
  if (points.length <= ACTUAL_MAX_CHARS) return { text, truncated: false };
  return {
    text: points.slice(0, ACTUAL_MAX_CHARS).join(""),
    truncated: true,
  };
}
