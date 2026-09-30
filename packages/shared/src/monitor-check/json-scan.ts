import type { PathSegment } from "./types";

// Every function here takes text that `JSON.parse` already accepted, so none handles malformed input.
const isSpace = (c: string) =>
  c === " " || c === "\t" || c === "\r" || c === "\n";

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text.charAt(i))) i++;
  return i;
}

/** Index just past the string that starts at `start`. */
function skipString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text.charAt(i) !== '"') {
    i += text.charAt(i) === "\\" ? 2 : 1;
  }
  return i + 1;
}

/**
 * End offset of every container, by start offset (0 for any other offset).
 * A container the text ends inside gets `text.length + 1`.
 * One iterative pass over the text, so a container is skipped by lookup.
 */
export function indexContainers(text: string): Int32Array {
  const ends = new Int32Array(text.length + 1);
  const open: number[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"') {
      i = skipString(text, i);
      continue;
    }
    if (c === "{" || c === "[") open.push(i);
    else if (c === "}" || c === "]") ends[open.pop() ?? 0] = i + 1;
    i++;
  }
  // A prefix can end inside a container: it "ends" past the text so callers see it is cut.
  for (const start of open) ends[start] = text.length + 1;
  return ends;
}

/** Index just past the value that starts at `start`. */
function skipValue(text: string, ends: Int32Array, start: number): number {
  const first = text.charAt(start);
  if (first === '"') return skipString(text, start);
  if (first === "{" || first === "[") return ends[start] ?? text.length;
  let i = start;
  while (i < text.length && !",]} \t\r\n".includes(text.charAt(i))) i++;
  return i;
}

/**
 * Visits the members of an object or array; `visit` returns true to stop early.
 * Returns true when the text ends inside the container (a cut prefix).
 */
function forEachMember(
  text: string,
  ends: Int32Array,
  start: number,
  visit: (key: string | number, valueStart: number) => boolean,
): boolean {
  const object = text.charAt(start) === "{";
  let i = skipSpace(text, start + 1);
  let index = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "}" || c === "]") return false;
    let key: string | number = index++;
    if (object) {
      const keyEnd = skipString(text, i);
      if (keyEnd > text.length) return true;
      key = JSON.parse(text.slice(i, keyEnd)) as string;
      i = skipSpace(text, skipSpace(text, keyEnd) + 1); // past ":"
      if (i >= text.length) return true;
    }
    if (visit(key, i)) return false;
    i = skipSpace(text, skipValue(text, ends, i));
    if (text.charAt(i) === ",") i = skipSpace(text, i + 1);
  }
  return true;
}

/**
 * Every value the path reaches. Walks only the visited segments: an object on
 * the path is read member by member so a repeated key is reported as several
 * matches, and every other value is skipped by `ends` without being parsed.
 * `ends` comes from `indexContainers`, computed once per response.
 */
export function findSpans(
  text: string,
  segments: PathSegment[],
  ends: Int32Array = indexContainers(text),
  truncated = false,
): { spans: [start: number, end: number][]; incomplete: boolean } {
  let incomplete = false;
  let starts: number[] = [skipSpace(text, 0)];
  for (const segment of segments) {
    const next: number[] = [];
    for (const start of starts) {
      const c = text.charAt(start);
      let cut = false;
      if (typeof segment === "string" && c === "{") {
        cut = forEachMember(text, ends, start, (key, valueStart) => {
          if (key === segment) next.push(valueStart);
          return false;
        });
      } else if (typeof segment === "number" && c === "[") {
        cut = forEachMember(text, ends, start, (key, valueStart) => {
          if (key !== segment) return false;
          next.push(valueStart);
          return true;
        });
      }
      if (cut) incomplete = true;
    }
    starts = next;
  }
  const spans: [number, number][] = [];
  for (const start of starts) {
    const end = skipValue(text, ends, start);
    const c = text.charAt(start);
    if (c === "{" || c === "[") {
      // The type is known even when the prefix cuts the container.
      spans.push([start, Math.min(end, text.length)]);
    } else if (end > text.length || (truncated && end === text.length)) {
      // A string or number the prefix cuts (or may cut) has no known value.
      incomplete = true;
    } else {
      spans.push([start, end]);
    }
  }
  return { spans, incomplete };
}

/** JSON type of the value starting at `start`, read from its first character. */
export function jsonTypeAt(text: string, start: number): string {
  switch (text.charAt(start)) {
    case "{":
      return "object";
    case "[":
      return "array";
    case '"':
      return "string";
    case "t":
    case "f":
      return "boolean";
    case "n":
      return "null";
    default:
      return "number";
  }
}

/** Parsed values of `findSpans`; parsing a very deep value may throw `RangeError`. */
export function findAll(
  text: string,
  segments: PathSegment[],
  ends: Int32Array = indexContainers(text),
): unknown[] {
  return findSpans(text, segments, ends).spans.map(
    ([start, end]) => JSON.parse(text.slice(start, end)) as unknown,
  );
}
