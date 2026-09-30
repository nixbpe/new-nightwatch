import type { PathSegment } from "./types";

// The scanners below expect a whole JSON document (`JSON.parse` accepted it) or a valid
// prefix of one (`isJsonPrefix` accepted it). On other text they still terminate, because
// every loop must advance, but they may throw `SyntaxError`.
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

const WORDS = ["true", "false", "null"];
const isDigit = (c: string) => c >= "0" && c <= "9";

/**
 * True when `text` is valid JSON or a prefix of one: the first structural
 * error that is not the end of the text makes it false. A second top-level
 * value after the first one ends (NDJSON) is an error. One iterative pass,
 * linear in the text, for a body the reader cut at its size limit.
 */
export function isJsonPrefix(text: string): boolean {
  const n = text.length;
  // true: object, false: array.
  const stack: boolean[] = [];
  type State = "value" | "first" | "key" | "colon" | "after";
  let state: State = "value";
  let i = 0;
  while (i < n) {
    const c = text.charAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    const top = stack[stack.length - 1];
    if (state === "after") {
      if (top === undefined) return false; // a second document
      if (c === ",") state = top ? "key" : "value";
      else if (c === (top ? "}" : "]")) {
        stack.pop();
      } else return false;
      i++;
      continue;
    }
    if (state === "colon") {
      if (c !== ":") return false;
      state = "value";
      i++;
      continue;
    }
    if (state === "first" || state === "key") {
      // Inside an object: a key string (or `}` straight after `{`).
      if (c === "}" && state === "first") {
        stack.pop();
        state = "after";
        i++;
        continue;
      }
      if (c !== '"') return false;
      const end = skipJsonString(text, i);
      if (end === -1) return false;
      if (end > n) return true;
      i = end;
      state = "colon";
      continue;
    }
    // state === "value".
    if (c === "{") {
      stack.push(true);
      state = "first";
      i++;
    } else if (c === "[") {
      stack.push(false);
      state = "value";
      i++;
      const next = skipSpace(text, i);
      if (next < n && text.charAt(next) === "]") {
        stack.pop();
        state = "after";
        i = next + 1;
      }
    } else if (c === '"') {
      const end = skipJsonString(text, i);
      if (end === -1) return false;
      if (end > n) return true;
      i = end;
      state = "after";
    } else if (c === "-" || isDigit(c)) {
      const end = skipJsonNumber(text, i);
      if (end === -1) return false;
      i = end;
      state = "after";
    } else {
      const word = WORDS.find((w) => w.charAt(0) === c);
      if (word === undefined) return false;
      const part = text.slice(i, i + word.length);
      if (part !== word.slice(0, part.length)) return false;
      i += part.length;
      state = "after";
    }
  }
  return true;
}

/** End of the string at `start`: -1 when malformed, past the text when the text ends inside it. */
function skipJsonString(text: string, start: number): number {
  const n = text.length;
  let i = start + 1;
  while (i < n) {
    const c = text.charAt(i);
    if (c === '"') return i + 1;
    if (c < " ") return -1;
    if (c === "\\") {
      if (i + 1 >= n) return n + 1;
      const e = text.charAt(i + 1);
      if (e === "u") {
        for (let k = 2; k <= 5; k++) {
          if (i + k >= n) return n + 1;
          if (!/[0-9a-fA-F]/.test(text.charAt(i + k))) return -1;
        }
        i += 6;
        continue;
      }
      if (!'"\\/bfnrt'.includes(e)) return -1;
      i += 2;
      continue;
    }
    i++;
  }
  return n + 1;
}

/** End of the number at `start`: -1 when malformed; the text end when it may continue. */
function skipJsonNumber(text: string, start: number): number {
  const n = text.length;
  let j = start;
  if (text.charAt(j) === "-") j++;
  if (j >= n) return n;
  if (text.charAt(j) === "0") j++;
  else if (isDigit(text.charAt(j)))
    while (j < n && isDigit(text.charAt(j))) j++;
  else return -1;
  if (j < n && text.charAt(j) === ".") {
    j++;
    if (j >= n) return n;
    if (!isDigit(text.charAt(j))) return -1;
    while (j < n && isDigit(text.charAt(j))) j++;
  }
  if (j < n && (text.charAt(j) === "e" || text.charAt(j) === "E")) {
    j++;
    if (j >= n) return n;
    if (text.charAt(j) === "+" || text.charAt(j) === "-") j++;
    if (j >= n) return n;
    if (!isDigit(text.charAt(j))) return -1;
    while (j < n && isDigit(text.charAt(j))) j++;
  }
  return j;
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
  if (first === "{" || first === "[") {
    const end = ends[start] ?? 0;
    // 0 means the scan never closed this container (malformed text): treat it as cut.
    return end > start ? end : text.length + 1;
  }
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
    const before = i;
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
    // Every pass must move forward, so malformed text cannot loop.
    if (i <= before) return true;
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
