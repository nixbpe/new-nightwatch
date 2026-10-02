import type { OutboundResponse } from "../outbound-http";
import { decodeBody } from "./assertions";
import { createRedactor, type Redactor } from "./redact";
import type { ResponseSnapshot, SnapshotHeader } from "./types";

const MAX_HEADERS = 50;
const MAX_HEADER_NAME_CHARS = 256;
const MAX_HEADER_VALUE_BYTES = 1024;
const MAX_REASON_CHARS = 128;
const MAX_BODY_BYTES = 16 * 1024;
const MASK = "•••";

/** Values that never leave the executor, whatever the target echoes. */
const ALWAYS_MASKED_HEADERS: ReadonlySet<string> = new Set([
  "set-cookie",
  "cookie",
  "authorization",
  "proxy-authorization",
  "www-authenticate",
  "proxy-authenticate",
]);

const TEXT_TYPES = [
  /^text\/[^/\s]+$/,
  /^application\/json$/,
  /^application\/[^/\s]+\+json$/,
  /^application\/xml$/,
  /^application\/[^/\s]+\+xml$/,
];

export interface SnapshotInput {
  /** Masked URL used when there is no response. */
  url: string;
  response: OutboundResponse | null;
  secretValues: readonly string[];
  secretHeaderNames: readonly string[];
  /** The request carried a query or a sent body (OD-58-11 (d)). */
  requestValues: boolean;
}

/** Cuts by code point so a surrogate pair is never split. */
function cutChars(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const points = Array.from(text);
  return points.length <= max
    ? { text, cut: false }
    : { text: points.slice(0, max).join(""), cut: true };
}

function cutBytes(text: string, max: number): { text: string; cut: boolean } {
  if (Buffer.byteLength(text) <= max) return { text, cut: false };
  let kept = "";
  let used = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point);
    if (used + size > max) break;
    kept += point;
    used += size;
  }
  return { text: kept, cut: true };
}

/** Header values arrive decoded as latin1, so a UTF-8 secret is echoed in its latin1 form. */
function needleForms(secretValues: readonly string[]): string[] {
  return secretValues
    .map((value) => Buffer.from(value, "utf8").toString("latin1"))
    .filter((form, i) => form !== secretValues[i]);
}

type Shown = { text: string; cut: boolean };

/**
 * Redacts, then replaces NUL (Postgres text and jsonb reject it), then cuts.
 * `cut` also covers a redactor that gave up scanning (`cutShort`), which drops text.
 */
function shown(
  redact: Redactor,
  text: string,
  max: number,
  cutter: (text: string, max: number) => Shown,
): Shown {
  const redacted = redact(text, max);
  const dropped = redact.cutShort === true;
  const cut = cutter(redacted.replaceAll("\u0000", "\uFFFD"), max);
  return { text: cut.text, cut: cut.cut || dropped };
}

/** Every form a target can echo: raw, latin1 (header decode), JSON-escaped and URL-encoded. */
function secretForms(secretValues: readonly string[]): string[] {
  return [...secretValues, ...needleForms(secretValues)].flatMap((value) => {
    let encoded: string[] = [];
    try {
      encoded = [encodeURIComponent(value)];
    } catch {
      // A lone surrogate has no URL-encoded form; the other forms still apply.
    }
    return [value, JSON.stringify(value).slice(1, -1), ...encoded];
  });
}

const foldHex = (text: string): string =>
  text.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());

/**
 * Folding a text reads at most two characters outside a needle: a `%` (or `%` and
 * a hex digit) before it can make its first one or two characters escape digits,
 * and one hex digit after it can complete an escape that starts two characters
 * before its end. A needle is therefore folded in each of these contexts and the
 * context is cut off again, so the single scan matches whatever surrounds it.
 */
const BEFORE = ["", "%", "%0"];
const AFTER = ["", "0"];

function foldedVariants(form: string): string[] {
  const variants = new Set<string>();
  for (const before of BEFORE) {
    for (const after of AFTER) {
      const folded = foldHex(`${before}${form}${after}`);
      variants.add(folded.slice(before.length, folded.length - after.length));
    }
  }
  return [...variants];
}

/**
 * RFC 3986 treats `%c3%a9` and `%C3%A9` as equal, but needles hold one case. One
 * scan runs on the text with its hex digits folded to upper case against the
 * folded needles, so overlapping matches still merge. A redactor changes the text
 * only where a needle matched, so `out === folded` means no secret was found and
 * the text is shown with its original case.
 */
function textRedactor(secretValues: readonly string[]): Redactor {
  const redact = createRedactor(
    [],
    secretForms(secretValues).flatMap(foldedVariants),
  );
  const wrapped = (text: string, maxChars?: number): string => {
    const folded = foldHex(text);
    const out = redact(folded, maxChars);
    return out === folded ? text : out;
  };
  return Object.defineProperty(wrapped, "cutShort", {
    get: () => redact.cutShort,
  });
}

/**
 * `http1.ts` lowercases header names, so a secret echoed as `X-Tok123` is stored
 * as `x-tok123`; names are matched with lowercased needles of every secret form.
 */
function nameRedactor(secretValues: readonly string[]): Redactor {
  return createRedactor(
    [],
    secretForms(secretValues).map((form) => form.toLowerCase()),
  );
}

function headersOf(
  response: OutboundResponse,
  redact: Redactor,
  redactName: Redactor,
  maskedNames: ReadonlySet<string>,
): { headers: SnapshotHeader[]; truncated: boolean } {
  const entries = Object.entries(response.headers);
  let truncated = entries.length > MAX_HEADERS;
  const headers = entries.slice(0, MAX_HEADERS).map(([rawName, rawValue]) => {
    const name = shown(redactName, rawName, MAX_HEADER_NAME_CHARS, cutChars);
    if (maskedNames.has(rawName.toLowerCase())) {
      truncated ||= name.cut;
      return { name: name.text, value: MASK, redacted: true };
    }
    const value = shown(redact, rawValue, MAX_HEADER_VALUE_BYTES, cutBytes);
    truncated ||= name.cut || value.cut;
    return {
      name: name.text,
      value: value.text,
      redacted: name.text.includes(MASK) || value.text.includes(MASK),
    };
  });
  return { headers, truncated };
}

function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function bodyOf(
  response: OutboundResponse,
  redact: Redactor,
): NonNullable<ResponseSnapshot["body"]> {
  if (response.body.length === 0) return { kind: "omitted", reason: "no_body" };
  // Chosen from the raw content-type, before any redaction.
  const type = mediaType(response.headers["content-type"]);
  if (!TEXT_TYPES.some((pattern) => pattern.test(type))) {
    return { kind: "omitted", reason: "not_text" };
  }
  const decoded = decodeBody(response);
  if (!decoded.ok) return { kind: "omitted", reason: "undecodable" };
  // Redact the whole text first so a secret cut by the limit is never shown in part.
  const cut = shown(redact, decoded.text, MAX_BODY_BYTES, cutBytes);
  return {
    kind: "text",
    text: cut.text,
    truncated: cut.cut || response.bodyTruncated,
    totalBytesRead: response.body.length,
  };
}

export function buildResponseSnapshot(input: SnapshotInput): ResponseSnapshot {
  const { response } = input;
  const base = {
    detailOmitted: input.requestValues ? ("request_values" as const) : null,
  };
  if (response === null) {
    return {
      ...base,
      url: input.url,
      statusLine: null,
      headers: [],
      headersTruncated: false,
      body: null,
    };
  }
  const statusLine = {
    httpVersion: response.httpVersion,
    status: response.status,
    reasonPhrase: null as string | null,
  };
  // Query values and the request body are not needles: a short non-secret needle
  // would blank ordinary text, and those requests keep no target text at all.
  const redact = textRedactor(input.secretValues);
  // finalUrl comes from the target's Location header, so it is target text too.
  const url = redact(response.finalUrl);
  if (input.requestValues) {
    return {
      ...base,
      url,
      statusLine,
      headers: [],
      headersTruncated: false,
      body: { kind: "omitted", reason: "request_values" },
    };
  }

  const reason =
    response.reasonPhrase === null
      ? null
      : shown(redact, response.reasonPhrase, MAX_REASON_CHARS, cutChars).text;
  const maskedNames = new Set([
    ...ALWAYS_MASKED_HEADERS,
    ...input.secretHeaderNames.map((name) => name.toLowerCase()),
  ]);
  const { headers, truncated } = headersOf(
    response,
    redact,
    nameRedactor(input.secretValues),
    maskedNames,
  );
  return {
    ...base,
    url,
    statusLine: { ...statusLine, reasonPhrase: reason === "" ? null : reason },
    headers,
    headersTruncated: truncated,
    body: bodyOf(response, redact),
  };
}
