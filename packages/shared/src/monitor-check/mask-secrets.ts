const MASK = "•••";

/**
 * Work limit for one masker, in characters scanned by `indexOf`. Past it the
 * text is masked whole (fail closed) and `cutShort` is set.
 */
const SCAN_BUDGET = 128 << 20;

export interface SecretMasker {
  (text: string): string;
  /** The latest call ran out of budget and masked its whole text. */
  readonly cutShort: boolean;
  /** Most original characters one secret occurrence can span (percent-encoded: 3 per character). */
  readonly maxSpan: number;
}

interface View {
  text: string;
  /** Original range of each view character; null means the identity map. */
  start: Int32Array | null;
  end: Int32Array | null;
}

const isHex = (char: string | undefined): boolean =>
  char !== undefined && /^[0-9a-fA-F]$/.test(char);

function percentDecode(text: string): string {
  return text.replace(/%[0-9a-fA-F]{2}/g, (escape) =>
    String.fromCharCode(parseInt(escape.slice(1), 16)),
  );
}

/** UTF-8 bytes as one character each, the way a head is decoded (`latin1`). */
const latin1Of = (text: string): string =>
  Buffer.from(text, "utf8").toString("latin1");

/** Lower-cases one UTF-16 unit when that keeps the length. */
function lowerUnit(char: string): string {
  const lower = char.toLowerCase();
  return lower.length === 1 ? lower : char;
}

/**
 * Text with each `%XX` read as one character whose code is the byte (hex case
 * does not matter), and optionally `+` read as a space, plus where every view
 * character came from in the original text.
 */
function decodedView(text: string, plus: boolean, lower: boolean): View {
  const chars: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < text.length;) {
    const char = text.charAt(i);
    let shown = char;
    let next = i + 1;
    if (char === "%" && isHex(text[i + 1]) && isHex(text[i + 2])) {
      shown = String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
      next = i + 3;
    } else if (plus && char === "+") {
      shown = " ";
    }
    chars.push(lower ? lowerUnit(shown) : shown);
    start.push(i);
    end.push(next);
    i = next;
  }
  return {
    text: chars.join(""),
    start: Int32Array.from(start),
    end: Int32Array.from(end),
  };
}

/**
 * Masks every secret value wherever the target echoes it, whatever URL encoding
 * it used. Matching runs on the text itself and on views with its percent
 * escapes (and `+`) decoded, so no encoder has to be guessed; matches map back
 * to the original text, overlapping or touching ones merge, and each merged run
 * becomes one mask. Text without a match comes back unchanged.
 *
 * Needles per secret: the value, its UTF-8-as-latin1 form (a header decode), that
 * form once more (a target that re-encodes the decoded header), each with its own
 * percent-decoded form (a secret that itself holds `%XX`), and the JSON-escaped
 * forms (original text only). `lowercase` also lower-cases needles and views, for
 * header names, which `http1.ts` lower-cases.
 */
export function createSecretMasker(
  secretValues: readonly string[],
  options: { lowercase?: boolean } = {},
): SecretMasker {
  const lower = options.lowercase === true;
  const norm = (text: string) =>
    lower ? Array.from(text, lowerUnit).join("") : text;
  const plain = new Set<string>();
  const json = new Set<string>();
  for (const value of secretValues) {
    const once = latin1Of(value);
    for (const form of [value, once, latin1Of(once)]) {
      plain.add(norm(form));
      plain.add(norm(percentDecode(form)));
      json.add(norm(JSON.stringify(form).slice(1, -1)));
    }
  }
  plain.delete("");
  json.delete("");
  const maxNeedle = Math.max(
    0,
    ...[...plain, ...json].map((needle) => needle.length),
  );

  let remaining = SCAN_BUDGET;
  let cutShort = false;

  const scan = (
    view: View,
    needles: Iterable<string>,
    ranges: [number, number][],
  ): boolean => {
    for (const needle of needles) {
      for (let from = 0; ;) {
        const at = view.text.indexOf(needle, from);
        remaining -=
          (at === -1 ? view.text.length - from : at - from) + needle.length;
        if (remaining < 0) return false;
        if (at === -1) break;
        const last = at + needle.length - 1;
        ranges.push([
          view.start === null ? at : (view.start[at] as number),
          view.end === null ? last + 1 : (view.end[last] as number),
        ]);
        from = at + 1;
      }
    }
    return true;
  };

  const mask = (text: string): string => {
    cutShort = false;
    if (plain.size === 0 && json.size === 0) return text;
    const identity: View = {
      text: lower ? Array.from(text, lowerUnit).join("") : text,
      start: null,
      end: null,
    };
    const ranges: [number, number][] = [];
    let complete = scan(identity, [...plain, ...json], ranges);
    if (complete && text.includes("%")) {
      complete = scan(decodedView(text, false, lower), plain, ranges);
    }
    if (complete && text.includes("+")) {
      complete = scan(decodedView(text, true, lower), plain, ranges);
    }
    if (!complete) {
      cutShort = true;
      return MASK;
    }
    if (ranges.length === 0) return text;
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = "";
    let cursor = 0;
    let [from, to] = ranges[0] as [number, number];
    const flush = () => {
      out += text.slice(cursor, from) + MASK;
      cursor = to;
    };
    for (const [start, end] of ranges.slice(1)) {
      if (start <= to) {
        to = Math.max(to, end);
      } else {
        flush();
        [from, to] = [start, end];
      }
    }
    flush();
    return out + text.slice(cursor);
  };

  return Object.defineProperty(
    Object.assign(mask, { cutShort: false, maxSpan: 3 * maxNeedle }),
    "cutShort",
    { get: () => cutShort },
  );
}
