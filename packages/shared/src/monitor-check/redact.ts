const MASK = "•••";
export const ACTUAL_MAX_CHARS = 200;

/**
 * `maxChars` bounds the work for a value that is shown cut to that many code
 * points: the result is a prefix of the full output holding at least
 * `maxChars + 1` code points when the full output is longer, so the caller's
 * cut lands on exactly the text an unbounded call would show.
 */
export type Redactor = (text: string, maxChars?: number) => string;

/**
 * Masks every secret value, its JSON-escaped and URL-encoded forms, and the
 * base64 of a Basic credential. Overlapping matches merge into one mask, so
 * "abc" and "bcd" in "abcd" leave no fragment. Matches are merged as they are
 * found, so memory does not grow with the number of occurrences.
 */
export function createRedactor(
  secretValues: readonly string[],
  extra: readonly string[] = [],
): Redactor {
  const found = new Set<string>();
  for (const value of [...secretValues, ...extra]) {
    found.add(value);
    found.add(JSON.stringify(value).slice(1, -1));
    try {
      found.add(encodeURIComponent(value));
    } catch {
      // A lone surrogate has no URL-encoded form; the other forms still apply.
    }
  }
  found.delete("");
  const needles = [...found];
  return (text, maxChars) => {
    // Code units are at least code points, so this many units hold maxChars + 1 points.
    const cap = maxChars === undefined ? Infinity : 2 * (maxChars + 1);
    const next = needles.map((needle) => text.indexOf(needle));
    let out = "";
    let cursor = 0;
    for (;;) {
      let first = -1;
      for (let i = 0; i < needles.length; i++) {
        const at = next[i] as number;
        if (at !== -1 && (first === -1 || at < (next[first] as number))) {
          first = i;
        }
      }
      if (first === -1) break;
      const start = next[first] as number;
      let end = start;
      for (let i = 0; i < needles.length;) {
        const at = next[i] as number;
        if (at !== -1 && at <= end) {
          const needle = needles[i] as string;
          end = Math.max(end, at + needle.length);
          next[i] = text.indexOf(needle, at + 1);
          i = 0;
        } else {
          i++;
        }
      }
      out += text.slice(cursor, start) + MASK;
      cursor = end;
      if (out.length >= cap) return out;
    }
    if (cursor === 0) return text;
    return (
      out + text.slice(cursor, cap === Infinity ? undefined : cursor + cap)
    );
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
