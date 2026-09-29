import type { PathSegment } from "./types";

type Node =
  | { t: "o"; entries: [string, Node][] }
  | { t: "a"; items: Node[] }
  | { t: "v"; value: unknown };

const MAX_DEPTH = 128;
const SCALAR = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

/**
 * Parses text that `JSON.parse` already accepted, keeping duplicate keys so a
 * path that reaches two members is reported as ambiguous.
 */
function parseNodes(text: string): Node {
  let i = 0;
  const skipSpace = () => {
    while (i < text.length && " \t\r\n".includes(text.charAt(i))) i++;
  };
  const string = (): string => {
    let end = i + 1;
    while (text.charAt(end) !== '"') end += text.charAt(end) === "\\" ? 2 : 1;
    const literal = text.slice(i, end + 1);
    i = end + 1;
    return JSON.parse(literal) as string;
  };
  const value = (depth: number): Node => {
    if (depth > MAX_DEPTH) throw new RangeError("JSON nested too deeply");
    skipSpace();
    const c = text.charAt(i);
    if (c === "{") {
      i++;
      const entries: [string, Node][] = [];
      skipSpace();
      if (text.charAt(i) === "}") {
        i++;
        return { t: "o", entries };
      }
      for (;;) {
        skipSpace();
        const key = string();
        skipSpace();
        i++; // ":"
        entries.push([key, value(depth + 1)]);
        skipSpace();
        if (text.charAt(i++) === "}") return { t: "o", entries };
      }
    }
    if (c === "[") {
      i++;
      const items: Node[] = [];
      skipSpace();
      if (text.charAt(i) === "]") {
        i++;
        return { t: "a", items };
      }
      for (;;) {
        items.push(value(depth + 1));
        skipSpace();
        if (text.charAt(i++) === "]") return { t: "a", items };
      }
    }
    if (c === '"') return { t: "v", value: string() };
    SCALAR.lastIndex = i;
    const match = SCALAR.exec(text);
    const literal = match?.[0] ?? "null";
    i += literal.length;
    return { t: "v", value: JSON.parse(literal) as unknown };
  };
  return value(0);
}

function toValue(node: Node): unknown {
  if (node.t === "v") return node.value;
  if (node.t === "a") return node.items.map(toValue);
  return Object.fromEntries(
    node.entries.map(([key, child]) => [key, toValue(child)]),
  );
}

/** Every value the path reaches. Throws `RangeError` beyond 128 levels of nesting. */
export function findAll(text: string, segments: PathSegment[]): unknown[] {
  let nodes: Node[] = [parseNodes(text)];
  for (const segment of segments) {
    nodes = nodes.flatMap((node): Node[] => {
      if (typeof segment === "string") {
        return node.t === "o"
          ? node.entries.filter(([key]) => key === segment).map(([, n]) => n)
          : [];
      }
      const item = node.t === "a" ? node.items[segment] : undefined;
      return item === undefined ? [] : [item];
    });
  }
  return nodes.map(toValue);
}
