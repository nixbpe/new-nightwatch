const MASK = "•••";

/**
 * Limits for one call, past which the text is masked whole (fail closed) and
 * `cutShort` is set: characters compared by `indexOf`, and characters decoded
 * into views.
 */
const LAYERS = 2;
const SCAN_BUDGET = 24 << 20;
const VIEW_BUDGET = 2 << 20;

/**
 * Most original characters one needle character can stand for after two decoding
 * layers: `\uXXXX` read out of a `\uXXXX`-escaped text (6 x 6), or a 3-byte UTF-8
 * character percent-encoded inside JSON escapes (9 x 6).
 */
const SPAN_PER_CHAR = 36;
const SPAN_PER_WIDE_CHAR = 54;

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
  /** Original range of each view character; null for the text itself. */
  start: Int32Array | null;
  end: Int32Array | null;
}

/** Decodes one view into another, or returns null when the result adds nothing. */
type Atom = (view: View) => View | null;

/**
 * Builds a view from characters that each come from a range of the source view.
 * A decoded view is never longer than its source, so buffers are sized once.
 */
class ViewBuilder {
  private readonly chars: Uint16Array;
  private readonly start: Int32Array;
  private readonly end: Int32Array;
  private length = 0;

  constructor(
    private readonly source: View,
    private readonly lower: boolean,
  ) {
    const size = source.text.length;
    this.chars = new Uint16Array(size);
    this.start = new Int32Array(size);
    this.end = new Int32Array(size);
  }

  push(char: string, from: number, to: number): void {
    const { source } = this;
    this.chars[this.length] = (this.lower ? lowerUnit(char) : char).charCodeAt(
      0,
    );
    this.start[this.length] =
      source.start === null ? from : (source.start[from] as number);
    this.end[this.length] =
      source.end === null ? to : (source.end[to - 1] as number);
    this.length++;
  }

  build(): View {
    const parts: string[] = [];
    for (let i = 0; i < this.length; i += 8192) {
      parts.push(
        String.fromCharCode(
          ...this.chars.subarray(i, Math.min(i + 8192, this.length)),
        ),
      );
    }
    return {
      text: parts.join(""),
      start: this.start.subarray(0, this.length),
      end: this.end.subarray(0, this.length),
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

// `ignoreBOM` keeps a decoded U+FEFF instead of dropping it.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
    let multibyte = false;
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
          multibyte = true;
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
    // Without a multi-byte sequence the UTF-8 reading equals the latin1 one.
    if (asUtf8 && !multibyte) return null;
    return unchanged(out.build(), view);
  };
}

const unchanged = (decoded: View, source: View): View | null =>
  decoded.text === source.text ? null : decoded;

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
    return unchanged(out.build(), view);
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
  const spanOf = (needle: string): number => {
    let span = 0;
    for (let i = 0; i < needle.length; i++) {
      const code = needle.charCodeAt(i);
      const wide = code >= 0x800 && (code < 0xd800 || code > 0xdfff);
      span += wide ? SPAN_PER_WIDE_CHAR : SPAN_PER_CHAR;
    }
    return span;
  };
  const maxSpan = Math.max(0, ...needles.map(spanOf));
  // `+` alone, `%XX` as latin1 or as UTF-8 (each also with `+`), and JSON escapes.
  const plusOnly: Atom = (view) => {
    const out = new ViewBuilder(view, lower);
    for (let i = 0; i < view.text.length; i++) {
      const char = view.text.charAt(i);
      out.push(char === "+" ? " " : char, i, i + 1);
    }
    return unchanged(out.build(), view);
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

  let scanLeft = SCAN_BUDGET;
  let viewLeft = VIEW_BUDGET;
  let cutShort = false;

  const rangesIn = (view: View, ranges: [number, number][]): boolean => {
    for (const needle of needles) {
      for (let from = 0; ;) {
        const at = view.text.indexOf(needle, from);
        scanLeft -=
          (at === -1 ? view.text.length - from : at - from) + needle.length;
        if (scanLeft < 0) return false;
        if (at === -1) break;
        ranges.push([
          view.start === null ? at : (view.start[at] as number),
          view.end === null
            ? at + needle.length
            : (view.end[at + needle.length - 1] as number),
        ]);
        from = at + 1;
      }
    }
    return true;
  };

  /**
   * Scans the text, then each decoded view depth first, so at most the text and
   * two views exist at once. A view that equals its source is skipped.
   */
  const scanTree = (
    view: View,
    layer: number,
    ranges: [number, number][],
  ): boolean => {
    if (!rangesIn(view, ranges)) return false;
    if (layer === LAYERS) return true;
    for (const atom of atoms) {
      if (!atom.applies(view.text)) continue;
      viewLeft -= view.text.length;
      if (viewLeft < 0) return false;
      const decoded = atom.run(view);
      if (decoded !== null && !scanTree(decoded, layer + 1, ranges)) {
        return false;
      }
    }
    return true;
  };

  const mask = (text: string, safeEnd?: number): string => {
    cutShort = false;
    scanLeft = SCAN_BUDGET;
    viewLeft = VIEW_BUDGET;
    if (needles.length === 0) return text.slice(0, safeEnd);
    const ranges: [number, number][] = [];
    const root: View = {
      text: lower ? Array.from(text, lowerUnit).join("") : text,
      start: null,
      end: null,
    };
    if (!scanTree(root, 0, ranges)) {
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
      maxSpan,
    }),
    "cutShort",
    { get: () => cutShort },
  );
}
