const MASK = "•••";
export const ACTUAL_MAX_CHARS = 200;

/**
 * Masks every secret value, its JSON-escaped and URL-encoded forms, and the
 * base64 of a Basic credential. Overlapping matches merge into one mask, so
 * "abc" and "bcd" in "abcd" leave no fragment.
 */
export function createRedactor(
  secretValues: readonly string[],
  extra: readonly string[] = [],
): (text: string) => string {
  const needles = new Set<string>();
  for (const value of [...secretValues, ...extra]) {
    needles.add(value);
    needles.add(JSON.stringify(value).slice(1, -1));
    try {
      needles.add(encodeURIComponent(value));
    } catch {
      // A lone surrogate has no URL-encoded form; the other forms still apply.
    }
  }
  needles.delete("");
  return (text) => {
    const ranges: [number, number][] = [];
    for (const needle of needles) {
      for (
        let at = text.indexOf(needle);
        at !== -1;
        at = text.indexOf(needle, at + 1)
      ) {
        ranges.push([at, at + needle.length]);
      }
    }
    if (ranges.length === 0) return text;
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = "";
    let cursor = 0;
    let [start, end] = ranges[0] ?? [0, 0];
    const flush = () => {
      out += text.slice(cursor, start) + MASK;
      cursor = end;
    };
    for (const [from, to] of ranges.slice(1)) {
      if (from <= end) end = Math.max(end, to);
      else {
        flush();
        [start, end] = [from, to];
      }
    }
    flush();
    return out + text.slice(cursor);
  };
}

/** Cuts by code point so a surrogate pair is never split. */
export function truncateActual(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= ACTUAL_MAX_CHARS) return { text, truncated: false };
  let kept = "";
  let count = 0;
  for (const point of text) {
    if (count === ACTUAL_MAX_CHARS) return { text: kept, truncated: true };
    kept += point;
    count++;
  }
  return { text, truncated: false };
}
