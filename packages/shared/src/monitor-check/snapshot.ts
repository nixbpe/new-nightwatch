import type { OutboundResponse } from "../outbound-http";
import { decodeBody } from "./assertions";
import { createRedactor, type Redactor } from "./redact";
import type { ResponseSnapshot, SnapshotHeader } from "./types";

const MAX_HEADERS = 50;
const MAX_HEADER_NAME_CHARS = 256;
const MAX_HEADER_VALUE_CHARS = 1024;
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

function redactAndCut(
  redact: Redactor,
  text: string,
  max: number,
): { text: string; cut: boolean } {
  return cutChars(redact(text, max), max);
}

function headersOf(
  response: OutboundResponse,
  redact: Redactor,
  maskedNames: ReadonlySet<string>,
): { headers: SnapshotHeader[]; truncated: boolean } {
  const entries = Object.entries(response.headers);
  let truncated = entries.length > MAX_HEADERS;
  const headers = entries.slice(0, MAX_HEADERS).map(([rawName, rawValue]) => {
    const name = redactAndCut(redact, rawName, MAX_HEADER_NAME_CHARS);
    if (maskedNames.has(rawName.toLowerCase())) {
      truncated ||= name.cut;
      return { name: name.text, value: MASK, redacted: true };
    }
    const value = redactAndCut(redact, rawValue, MAX_HEADER_VALUE_CHARS);
    truncated ||= name.cut || value.cut;
    return {
      name: name.text,
      value: value.text,
      redacted: name.text !== rawName || value.text.includes(MASK),
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
  const cut = cutBytes(redact(decoded.text, MAX_BODY_BYTES), MAX_BODY_BYTES);
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
  if (input.requestValues) {
    return {
      ...base,
      url: response.finalUrl,
      statusLine,
      headers: [],
      headersTruncated: false,
      body: { kind: "omitted", reason: "request_values" },
    };
  }

  // Query values and the request body are not needles: a short non-secret needle
  // would blank ordinary text, and those requests keep no target text at all.
  const redact = createRedactor(
    input.secretValues,
    needleForms(input.secretValues),
  );
  const reason =
    response.reasonPhrase === null
      ? null
      : redactAndCut(redact, response.reasonPhrase, MAX_REASON_CHARS).text;
  const maskedNames = new Set([
    ...ALWAYS_MASKED_HEADERS,
    ...input.secretHeaderNames.map((name) => name.toLowerCase()),
  ]);
  const { headers, truncated } = headersOf(response, redact, maskedNames);
  return {
    ...base,
    url: response.finalUrl,
    statusLine: { ...statusLine, reasonPhrase: reason === "" ? null : reason },
    headers,
    headersTruncated: truncated,
    body: bodyOf(response, redact),
  };
}
