const MASK = "•••";
export const ACTUAL_MAX_CHARS = 200;

/**
 * `maxChars` bounds the output, not the scan: the result is a prefix of the
 * full output holding at least `maxChars + 1` code points when the full
 * output is longer, so the caller's cut lands on exactly the text an unbounded
 * call would show. Text before the first match that would fill the prefix is
 * never scanned for later matches; one contiguous run of matches is scanned to
 * its end because the text after it is part of the shown output.
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
    // Next occurrence per needle; a min-heap of the needles that still have one.
    const next = needles.map((needle) => text.indexOf(needle));
    const heap = next.flatMap((at, i) => (at === -1 ? [] : [i]));
    const before = (a: number, b: number) =>
      (next[a] as number) < (next[b] as number);
    const siftDown = (from: number) => {
      for (let i = from; ;) {
        let low = i;
        for (const child of [2 * i + 1, 2 * i + 2]) {
          if (
            child < heap.length &&
            before(heap[child] as number, heap[low] as number)
          ) {
            low = child;
          }
        }
        if (low === i) return;
        [heap[i], heap[low]] = [heap[low] as number, heap[i] as number];
        i = low;
      }
    };
    for (let i = heap.length >> 1; i >= 0; i--) siftDown(i);

    let out = "";
    let cursor = 0;
    while (heap.length > 0) {
      const start = next[heap[0] as number] as number;
      // From here the output starts with out + text[cursor, start) + MASK
      // whatever the end of this group is, and that already fills the prefix.
      const gap = start - cursor;
      if (out.length + gap + MASK.length >= cap) {
        return gap >= cap
          ? out + text.slice(cursor, cursor + cap)
          : out + text.slice(cursor, start) + MASK;
      }
      let end = start;
      while (heap.length > 0 && (next[heap[0] as number] as number) <= end) {
        const i = heap[0] as number;
        const needle = needles[i] as string;
        const at = next[i] as number;
        end = Math.max(end, at + needle.length);
        // Occurrences that start before end - length + 1 end inside this group.
        const again = text.indexOf(
          needle,
          Math.max(at + 1, end - needle.length + 1),
        );
        if (again === -1) {
          heap[0] = heap[heap.length - 1] as number;
          heap.pop();
        } else {
          next[i] = again;
        }
        siftDown(0);
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
