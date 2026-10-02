const MASK = "•••";

/**
 * Work limit for one masker, in characters scanned or decoded. Past it the text
 * is masked whole (fail closed) and `cutShort` is set.
 */
const SCAN_BUDGET = 128 << 20;

/**
 * Original characters one view character can stand for: a percent-encoded
 * 3-byte UTF-8 character (9) or a JSON `\uXXXX` escape (6). Two layers compound.
 */
const MAX_LAYER_EXPANSION = 9;
const LAYERS = 2;

export interface SecretMasker {
  /**
   * With `safeEnd`, only the output for the text before that position is
   * returned (extended over a match that starts before it).
   */
  (text: string, safeEnd?: number): string;
  /** The latest call ran out of budget and masked its whole text. */
  readonly cutShort: boolean;
  /** Most original characters one secret occurrence can span. */
  readonly maxSpan: number;
}

interface View {
  text: string;
  /** Original range of each view character. */
  start: Int32Array;
  end: Int32Array;
}

type Atom = (view: View) => View;

/** Builds a view from characters that each come from a range of the source view. */
class ViewBuilder {
  private readonly chars: string[] = [];
  private readonly start: number[] = [];
  private readonly end: number[] = [];

  constructor(
    private readonly source: View,
    private readonly lower: boolean,
  ) {}

  push(char: string, from: number, to: number): void {
    this.chars.push(this.lower ? lowerUnit(char) : char);
    this.start.push(this.source.start[from] as number);
    this.end.push(this.source.end[to - 1] as number);
  }

  build(): View {
    return {
      text: this.chars.join(""),
      start: Int32Array.from(this.start),
      end: Int32Array.from(this.end),
    };
  }
}

/** Lower-cases one UTF-16 unit when that keeps the length. */
function lowerUnit(char: string): string {
  const lower = char.toLowerCase();
  return lower.length === 1 ? lower : char;
}

const HEX = /^[0-9a-fA-F]{2}$/;

function byteAt(text: string, at: number): number {
  return text.charAt(at) === "%" && HEX.test(text.slice(at + 1, at + 3))
    ? parseInt(text.slice(at + 1, at + 3), 16)
    : -1;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 lead byte to sequence length; 1 for a byte that cannot lead. */
function sequenceLength(lead: number): number {
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  if (lead >= 0xe0 && lead < 0xf0) return 3;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  return 1;
}

/**
 * `%XX` read as bytes, each shown as one latin1 character (a head decode) or,
 * with `asUtf8`, a valid UTF-8 sequence shown as its character and an invalid
 * byte as latin1. `plus` also reads `+` as a space. Hex case does not matter.
 */
function percentAtom(plus: boolean, asUtf8: boolean, lower: boolean): Atom {
  return (view) => {
    const out = new ViewBuilder(view, lower);
    const { text } = view;
    for (let i = 0; i < text.length;) {
      if (byteAt(text, i) === -1) {
        const char = text.charAt(i);
        out.push(plus && char === "+" ? " " : char, i, i + 1);
        i++;
        continue;
      }
      const bytes: number[] = [];
      for (let at = i; byteAt(text, at) !== -1; at += 3) {
        bytes.push(byteAt(text, at));
      }
      for (let k = 0; k < bytes.length;) {
        const lead = bytes[k] as number;
        const need = asUtf8 ? sequenceLength(lead) : 1;
        let decoded: string | null = null;
        if (need > 1 && k + need <= bytes.length) {
          try {
            decoded = utf8.decode(Uint8Array.from(bytes.slice(k, k + need)));
          } catch {
            decoded = null;
          }
        }
        const from = i + 3 * k;
        if (decoded === null) {
          out.push(String.fromCharCode(lead), from, from + 3);
          k++;
        } else {
          for (const unit of decoded) {
            for (let u = 0; u < unit.length; u++) {
              out.push(unit.charAt(u), from, from + 3 * need);
            }
          }
          k += need;
        }
      }
      i += 3 * bytes.length;
    }
    return out.build();
  };
}

const JSON_SIMPLE: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** JSON string escapes: `\uXXXX` (a surrogate pair is two escapes), `\/`, `\"`, `\\`, `\b\f\n\r\t`. */
function jsonAtom(lower: boolean): Atom {
  return (view) => {
    const out = new ViewBuilder(view, lower);
    const { text } = view;
    for (let i = 0; i < text.length;) {
      const char = text.charAt(i);
      const next = text.charAt(i + 1);
      if (
        char === "\\" &&
        next === "u" &&
        /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))
      ) {
        out.push(
          String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)),
          i,
          i + 6,
        );
        i += 6;
      } else if (char === "\\" && JSON_SIMPLE[next] !== undefined) {
        out.push(JSON_SIMPLE[next], i, i + 2);
        i += 2;
      } else {
        out.push(char, i, i + 1);
        i++;
      }
    }
    return out.build();
  };
}

const percentDecode = (text: string): string =>
  text.replace(/%[0-9a-fA-F]{2}/g, (escape) =>
    String.fromCharCode(parseInt(escape.slice(1), 16)),
  );

/** UTF-8 bytes as one character each, the way a head is decoded (`latin1`). */
const latin1Of = (text: string): string =>
  Buffer.from(text, "utf8").toString("latin1");

/**
 * Masks every secret value wherever the target echoes it, whatever encoding it
 * used. Matching runs on the text and on views of it with encodings undone (up
 * to two layers, in any order): percent escapes as latin1 bytes or as UTF-8,
 * `+` as a space, and JSON string escapes. Matches map back to the original
 * text, overlapping or touching ones merge, and each merged run becomes one
 * mask. Text without a match comes back unchanged.
 *
 * Needles per secret: the value, its UTF-8-as-latin1 form (a header decode) and
 * that form once more (a target that re-encodes the decoded header), each with
 * its percent-decoded form (a secret that itself holds `%XX`). `lowercase` also
 * lower-cases needles and views, for header names, which `http1.ts` lower-cases.
 */
export function createSecretMasker(
  secretValues: readonly string[],
  options: { lowercase?: boolean } = {},
): SecretMasker {
  const lower = options.lowercase === true;
  const norm = (text: string) =>
    lower ? Array.from(text, lowerUnit).join("") : text;
  const needleSet = new Set<string>();
  for (const value of secretValues) {
    const once = latin1Of(value);
    for (const form of [value, once, latin1Of(once)]) {
      needleSet.add(norm(form));
      needleSet.add(norm(percentDecode(form)));
    }
  }
  needleSet.delete("");
  const needles = [...needleSet];
  const maxNeedle = Math.max(0, ...needles.map((needle) => needle.length));
  // `+` alone, `%XX` as latin1 or as UTF-8 (each also with `+`), and JSON escapes.
  const plusOnly: Atom = (view) => {
    const out = new ViewBuilder(view, lower);
    for (let i = 0; i < view.text.length; i++) {
      const char = view.text.charAt(i);
      out.push(char === "+" ? " " : char, i, i + 1);
    }
    return out.build();
  };
  const atoms: { applies: (text: string) => boolean; run: Atom }[] = [
    { applies: (t) => t.includes("+"), run: plusOnly },
    { applies: (t) => t.includes("%"), run: percentAtom(false, false, lower) },
    { applies: (t) => t.includes("%"), run: percentAtom(false, true, lower) },
    {
      applies: (t) => t.includes("%") && t.includes("+"),
      run: percentAtom(true, false, lower),
    },
    {
      applies: (t) => t.includes("%") && t.includes("+"),
      run: percentAtom(true, true, lower),
    },
    { applies: (t) => t.includes("\\"), run: jsonAtom(lower) },
  ];

  let remaining = SCAN_BUDGET;
  let cutShort = false;

  const spend = (units: number): boolean => {
    remaining -= units;
    return remaining >= 0;
  };

  /** The text itself plus every distinct view of up to `LAYERS` decoding layers. */
  const viewsOf = (text: string): View[] | null => {
    if (!spend(text.length)) return null;
    const lowered = lower ? Array.from(text, lowerUnit).join("") : text;
    const root: View = {
      text: lowered,
      start: Int32Array.from({ length: text.length }, (_, i) => i),
      end: Int32Array.from({ length: text.length }, (_, i) => i + 1),
    };
    const seen = new Set([root.text]);
    const views = [root];
    let frontier = [root];
    for (let layer = 0; layer < LAYERS; layer++) {
      const next: View[] = [];
      for (const view of frontier) {
        for (const atom of atoms) {
          if (!atom.applies(view.text)) continue;
          if (!spend(view.text.length)) return null;
          const decoded = atom.run(view);
          if (seen.has(decoded.text)) continue;
          seen.add(decoded.text);
          views.push(decoded);
          next.push(decoded);
        }
      }
      frontier = next;
    }
    return views;
  };

  const rangesIn = (view: View, ranges: [number, number][]): boolean => {
    for (const needle of needles) {
      for (let from = 0; ;) {
        const at = view.text.indexOf(needle, from);
        if (
          !spend(
            (at === -1 ? view.text.length - from : at - from) + needle.length,
          )
        ) {
          return false;
        }
        if (at === -1) break;
        ranges.push([
          view.start[at] as number,
          view.end[at + needle.length - 1] as number,
        ]);
        from = at + 1;
      }
    }
    return true;
  };

  const mask = (text: string, safeEnd?: number): string => {
    cutShort = false;
    if (needles.length === 0) return text.slice(0, safeEnd);
    const views = viewsOf(text);
    const ranges: [number, number][] = [];
    if (views === null || !views.every((view) => rangesIn(view, ranges))) {
      cutShort = true;
      return MASK;
    }
    // Never end on half of a surrogate pair.
    let limit = safeEnd ?? text.length;
    const last = text.charCodeAt(limit - 1);
    if (limit < text.length && last >= 0xd800 && last <= 0xdbff) limit--;
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = "";
    let cursor = 0;
    const merged: [number, number][] = [];
    for (const [start, end] of ranges) {
      const tail = merged[merged.length - 1];
      if (tail !== undefined && start <= tail[1])
        tail[1] = Math.max(tail[1], end);
      else merged.push([start, end]);
    }
    for (const [start, end] of merged) {
      if (start >= limit) break;
      out += text.slice(cursor, start) + MASK;
      cursor = end;
      limit = Math.max(limit, end);
    }
    return out + text.slice(cursor, limit);
  };

  return Object.defineProperty(
    Object.assign(mask, {
      cutShort: false,
      maxSpan: MAX_LAYER_EXPANSION ** LAYERS * maxNeedle,
    }),
    "cutShort",
    { get: () => cutShort },
  );
}
