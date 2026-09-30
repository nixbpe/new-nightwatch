import { isForbiddenAddress, parseIp } from "./address-policy";

export const MAX_URL_LENGTH = 2048;
const MASK = "•••";

export type UrlRejection =
  | "invalid_url"
  | "unsupported_scheme"
  | "userinfo_not_allowed"
  | "url_too_long"
  | "port_not_allowed"
  | "blocked_address";

export type UrlCheck =
  { ok: true; url: URL } | { ok: false; reason: UrlRejection };

function portAllowed(port: string): boolean {
  if (port === "") return true; // the WHATWG parser drops the scheme default (80, 443)
  const value = Number(port);
  return value === 80 || value === 443 || (value >= 1024 && value <= 65535);
}

export function literalHost(url: URL): string | null {
  const host = url.hostname;
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  return parseIp(bare) ? bare : null;
}

export function isLocalhostName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.+$/, "");
  return name === "localhost" || name.endsWith(".localhost");
}

/**
 * Static URL policy (no DNS). The WHATWG parser normalizes numeric IPv4 forms
 * (`0x7f.1`, `2130706433`) and IPv4-mapped IPv6 before the literal is checked.
 */
export function validateOutboundUrl(raw: string): UrlCheck {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "url_too_long" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "userinfo_not_allowed" };
  }
  if (url.hostname === "") return { ok: false, reason: "invalid_url" };
  if (!portAllowed(url.port)) return { ok: false, reason: "port_not_allowed" };
  if (isLocalhostName(url.hostname)) {
    return { ok: false, reason: "blocked_address" };
  }
  const literal = literalHost(url);
  if (literal !== null && isForbiddenAddress(literal)) {
    return { ok: false, reason: "blocked_address" };
  }
  return { ok: true, url };
}

/** Replaces every query value (or bare pair) with `•••`; drops userinfo and fragment. */
export function maskUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    const cut = raw.indexOf("?");
    return cut === -1 ? raw : `${raw.slice(0, cut)}?${MASK}`;
  }
  const query = url.search.slice(1);
  // Every pair keeps its position; a bare pair is itself the secret, so it is replaced whole.
  const masked = query
    .split("&")
    .map((pair) => {
      if (pair === "") return pair;
      const eq = pair.indexOf("=");
      return eq === -1 ? MASK : `${pair.slice(0, eq)}=${MASK}`;
    })
    .join("&");
  const origin = `${url.protocol}//${url.host}${url.pathname}`;
  return masked === "" ? origin : `${origin}?${masked}`;
}
