import type { OutboundResponse } from "../outbound-http";
import { decodeBody } from "./assertions";
import { createSecretMasker, type SecretMasker } from "./mask-secrets";
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

type Shown = { text: string; cut: boolean };

/**
 * Masks, then replaces NUL (Postgres text and jsonb reject it), then cuts.
 * `cut` also covers a masker that ran out of budget (`cutShort`), which drops text.
 */
function shown(
  mask: SecretMasker,
  text: string,
  max: number,
  cutter: (text: string, max: number) => Shown,
): Shown {
  const masked = mask(text);
  const dropped = mask.cutShort;
  const cut = cutter(masked.replaceAll("\u0000", "\uFFFD"), max);
  return { text: cut.text, cut: cut.cut || dropped };
}

/**
 * Scanning a 1 MiB body costs a pass per needle and view, so only a prefix is
 * scanned. A secret that straddles the end of the prefix would show its head, so
 * the output of the last `maxSpan` input characters (at most 3 output characters
 * each, the mask) is dropped. The caller learns that the input was cut.
 */
function maskPrefix(
  mask: SecretMasker,
  text: string,
  maxChars: number,
): { mask: SecretMasker; inputCut: boolean } {
  const scanned = 2 * (maxChars + 1) + 4 * mask.maxSpan;
  if (text.length <= scanned) return { mask, inputCut: false };
  const wrapped = (): string => {
    const out = mask(text.slice(0, scanned));
    return out.slice(0, Math.max(0, out.length - 3 * mask.maxSpan));
  };
  return {
    mask: Object.defineProperties(
      Object.assign(wrapped, { cutShort: false, maxSpan: mask.maxSpan }),
      {
        cutShort: { get: () => mask.cutShort },
      },
    ),
    inputCut: true,
  };
}

function headersOf(
  response: OutboundResponse,
  redact: SecretMasker,
  redactName: SecretMasker,
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
  textRedact: SecretMasker,
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
  const { mask: redact, inputCut } = maskPrefix(
    textRedact,
    decoded.text,
    MAX_BODY_BYTES,
  );
  const cut = shown(redact, decoded.text, MAX_BODY_BYTES, cutBytes);
  return {
    kind: "text",
    text: cut.text,
    truncated: cut.cut || inputCut || response.bodyTruncated,
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
  const redact = createSecretMasker(input.secretValues);
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
    createSecretMasker(input.secretValues, { lowercase: true }),
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
