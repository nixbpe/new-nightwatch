import type { PathSegment } from "./types";

/** Text that `JSON.parse` already accepted, so no error handling for malformed input. */
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

/** Index just past the value that starts at `start`; iterative, any nesting depth. */
function skipValue(text: string, start: number): number {
  const first = text.charAt(start);
  if (first === '"') return skipString(text, start);
  if (first === "{" || first === "[") {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const c = text.charAt(i);
      if (c === '"') {
        i = skipString(text, i);
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return i;
  }
  let i = start;
  while (i < text.length && !",]} \t\r\n".includes(text.charAt(i))) i++;
  return i;
}

/** Starts of the members of an object or array; `visit` returns true to stop early. */
function forEachMember(
  text: string,
  start: number,
  visit: (key: string | number, valueStart: number) => boolean,
): void {
  const object = text.charAt(start) === "{";
  let i = skipSpace(text, start + 1);
  let index = 0;
  while (i < text.length && text.charAt(i) !== "}" && text.charAt(i) !== "]") {
    let key: string | number = index++;
    if (object) {
      const keyEnd = skipString(text, i);
      key = JSON.parse(text.slice(i, keyEnd)) as string;
      i = skipSpace(text, skipSpace(text, keyEnd) + 1); // past ":"
    }
    if (visit(key, i)) return;
    i = skipSpace(text, skipValue(text, i));
    if (text.charAt(i) === ",") i = skipSpace(text, i + 1);
  }
}

/**
 * Every value the path reaches. Walks only the visited segments: an object on
 * the path is read member by member so a repeated key is reported as several
 * matches, and every other value is skipped without being parsed.
 */
export function findAll(text: string, segments: PathSegment[]): unknown[] {
  let starts: number[] = [skipSpace(text, 0)];
  for (const segment of segments) {
    const next: number[] = [];
    for (const start of starts) {
      const c = text.charAt(start);
      if (typeof segment === "string" && c === "{") {
        forEachMember(text, start, (key, valueStart) => {
          if (key === segment) next.push(valueStart);
          return false;
        });
      } else if (typeof segment === "number" && c === "[") {
        forEachMember(text, start, (key, valueStart) => {
          if (key !== segment) return false;
          next.push(valueStart);
          return true;
        });
      }
    }
    starts = next;
  }
  return starts.map(
    (start) => JSON.parse(text.slice(start, skipValue(text, start))) as unknown,
  );
}
