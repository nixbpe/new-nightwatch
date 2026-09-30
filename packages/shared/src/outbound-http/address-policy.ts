/** Address bytes: 4 for IPv4, 16 for IPv6. */
type Bytes = number[];

interface Cidr {
  base: Bytes;
  prefix: number;
}

export function parseIp(input: string): Bytes | null {
  let text = input;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  return text.includes(":") ? parseIpv6(text) : parseIpv4(text);
}

function parseIpv4(text: string): Bytes | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: Bytes = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function parseIpv6(text: string): Bytes | null {
  let head = text;
  let tail: string | null = null;
  const gap = text.indexOf("::");
  if (gap !== -1) {
    if (text.indexOf("::", gap + 1) !== -1) return null;
    head = text.slice(0, gap);
    tail = text.slice(gap + 2);
  }
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const pieces = part.split(":");
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes(".")) {
        if (index !== pieces.length - 1) return null;
        const v4 = parseIpv4(piece);
        if (!v4) return null;
        const [a = 0, b = 0, c = 0, d = 0] = v4;
        groups.push(a * 256 + b, c * 256 + d);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  const headGroups = toGroups(head);
  const tailGroups = tail === null ? [] : toGroups(tail);
  if (!headGroups || !tailGroups) return null;
  let groups: number[];
  if (tail === null) {
    if (headGroups.length !== 8) return null;
    groups = headGroups;
  } else {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return null;
    groups = [
      ...headGroups,
      ...new Array<number>(missing).fill(0),
      ...tailGroups,
    ];
  }
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function cidr(text: string): Cidr {
  const [address = "", prefix] = text.split("/");
  const base = parseIp(address);
  if (!base) throw new Error(`invalid CIDR ${text}`);
  return { base, prefix: Number(prefix) };
}

function inCidr(bytes: Bytes, range: Cidr): boolean {
  if (bytes.length !== range.base.length) return false;
  let bits = range.prefix;
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((range.base[i] ?? 0) & mask))
      return false;
  }
  return true;
}

// Ranges fixed by the F-005 spec (Authorization and security, SSRF helper).
const FORBIDDEN_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
].map(cidr);

// ::ffff:0:0/96 is absent on purpose: the embedded IPv4 is checked against FORBIDDEN_V4.
const FORBIDDEN_V6 = [
  "::/128",
  "::1/128",
  "::/96", // IPv4-compatible
  "::ffff:0:0:0/96", // IPv4-translated
  "64:ff9b::/96",
  "64:ff9b:1::/48", // local-use NAT64
  "100::/64",
  "2001::/32",
  "2001:db8::/32",
  "2002::/16",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
].map(cidr);

function embeddedIpv4(bytes: Bytes): Bytes | null {
  if (bytes.length !== 16) return null;
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return null;
  return bytes[10] === 0xff && bytes[11] === 0xff ? bytes.slice(12) : null;
}

/** Unparseable input counts as forbidden (fail closed). */
export function isForbiddenAddress(address: string): boolean {
  const parsed = parseIp(address);
  if (!parsed) return true;
  const bytes = embeddedIpv4(parsed) ?? parsed;
  const ranges = bytes.length === 4 ? FORBIDDEN_V4 : FORBIDDEN_V6;
  return ranges.some((range) => inCidr(bytes, range));
}

/** Compares two textual addresses, treating an IPv4-mapped IPv6 form as its IPv4 address. */
export function sameAddress(a: string, b: string): boolean {
  const left = parseIp(a);
  const right = parseIp(b);
  if (!left || !right) return false;
  const l = embeddedIpv4(left) ?? left;
  const r = embeddedIpv4(right) ?? right;
  return l.length === r.length && l.every((byte, i) => byte === r[i]);
}
