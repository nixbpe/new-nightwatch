const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
]);

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Returns the offending header name, or null when every header is allowed (AC-29). */
export function findInvalidHeader(
  headers: Record<string, string>,
): string | null {
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      !TOKEN.test(name) ||
      FORBIDDEN_HEADERS.has(lower) ||
      lower.startsWith("proxy-") ||
      /[\r\n\0]/.test(value)
    ) {
      return name;
    }
  }
  return null;
}
