import { describe, expect, it } from "vitest";

import {
  isForbiddenAddress,
  sameAddress,
} from "../../src/outbound-http/address-policy";

// [range, first address, last address]
const FORBIDDEN_V4: [string, string, string][] = [
  ["0.0.0.0/8", "0.0.0.0", "0.255.255.255"],
  ["10.0.0.0/8", "10.0.0.0", "10.255.255.255"],
  ["100.64.0.0/10", "100.64.0.0", "100.127.255.255"],
  ["127.0.0.0/8", "127.0.0.0", "127.255.255.255"],
  ["169.254.0.0/16", "169.254.0.0", "169.254.255.255"],
  ["172.16.0.0/12", "172.16.0.0", "172.31.255.255"],
  ["192.0.0.0/24", "192.0.0.0", "192.0.0.255"],
  ["192.0.2.0/24", "192.0.2.0", "192.0.2.255"],
  ["192.88.99.0/24", "192.88.99.0", "192.88.99.255"],
  ["192.168.0.0/16", "192.168.0.0", "192.168.255.255"],
  ["198.18.0.0/15", "198.18.0.0", "198.19.255.255"],
  ["198.51.100.0/24", "198.51.100.0", "198.51.100.255"],
  ["203.0.113.0/24", "203.0.113.0", "203.0.113.255"],
  ["224.0.0.0/4", "224.0.0.0", "239.255.255.255"],
  ["240.0.0.0/4", "240.0.0.0", "255.255.255.255"],
];

const FORBIDDEN_V6: [string, string, string][] = [
  ["::/128", "::", "::"],
  ["::1/128", "::1", "::1"],
  ["64:ff9b::/96", "64:ff9b::", "64:ff9b::ffff:ffff"],
  ["100::/64", "100::", "100::ffff:ffff:ffff:ffff"],
  ["2001::/32", "2001::", "2001:0:ffff:ffff:ffff:ffff:ffff:ffff"],
  ["2001:db8::/32", "2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"],
  ["2002::/16", "2002::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
  ["fc00::/7", "fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
  ["fe80::/10", "fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
  ["ff00::/8", "ff00::", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
];

// One address just outside each range edge, plus common public hosts.
const PUBLIC_V4 = [
  "1.1.1.1",
  "8.8.8.8",
  "9.255.255.255",
  "11.0.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "126.255.255.255",
  "128.0.0.0",
  "169.253.255.255",
  "169.255.0.0",
  "172.15.255.255",
  "172.32.0.0",
  "192.0.1.0",
  "192.0.3.0",
  "192.88.98.255",
  "192.88.100.0",
  "192.167.255.255",
  "192.169.0.0",
  "198.17.255.255",
  "198.20.0.0",
  "198.51.99.255",
  "198.51.101.0",
  "203.0.112.255",
  "203.0.114.0",
  "223.255.255.255",
];
const PUBLIC_V6 = [
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "2001:1::",
  "2001:db9::",
  "2003::",
  "2001:ffff::",
  "1ff:ffff:ffff:ffff::",
  "100:0:0:1::",
  "64:ff9c::",
  "2000::",
  "fbff::1",
  "fec0::",
];

describe("isForbiddenAddress", () => {
  it.each(FORBIDDEN_V4)(
    "blocks IPv4 %s at both ends",
    (_range, first, last) => {
      expect(isForbiddenAddress(first)).toBe(true);
      expect(isForbiddenAddress(last)).toBe(true);
    },
  );

  it.each(FORBIDDEN_V6)(
    "blocks IPv6 %s at both ends",
    (_range, first, last) => {
      expect(isForbiddenAddress(first)).toBe(true);
      expect(isForbiddenAddress(last)).toBe(true);
    },
  );

  it("allows addresses just outside each IPv4 range", () => {
    for (const address of PUBLIC_V4)
      expect(isForbiddenAddress(address), address).toBe(false);
  });

  it("allows addresses just outside each IPv6 range", () => {
    for (const address of PUBLIC_V6)
      expect(isForbiddenAddress(address), address).toBe(false);
  });

  it("blocks the cloud metadata endpoints", () => {
    for (const address of [
      "169.254.169.254",
      "169.254.170.2",
      "fd00:ec2::254",
    ]) {
      expect(isForbiddenAddress(address), address).toBe(true);
    }
  });

  it("checks the IPv4 embedded in an IPv4-mapped IPv6 address", () => {
    expect(isForbiddenAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isForbiddenAddress("::ffff:7f00:1")).toBe(true);
    expect(isForbiddenAddress("::ffff:10.1.2.3")).toBe(true);
    expect(isForbiddenAddress("::ffff:0.0.0.0")).toBe(true);
    expect(isForbiddenAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isForbiddenAddress("[::ffff:7f00:1]")).toBe(true);
  });

  it("treats unparseable input as forbidden", () => {
    for (const value of [
      "",
      "not-an-ip",
      "1.2.3",
      "256.1.1.1",
      "1:2:3",
      "::1::2",
      "0x7f.1",
    ]) {
      expect(isForbiddenAddress(value), value).toBe(true);
    }
  });
});

describe("sameAddress", () => {
  it("matches equal addresses across notations", () => {
    expect(sameAddress("127.0.0.1", "127.0.0.1")).toBe(true);
    expect(sameAddress("::ffff:127.0.0.1", "127.0.0.1")).toBe(true);
    expect(sameAddress("2001:0db8::1", "2001:db8:0:0:0:0:0:1")).toBe(true);
  });

  it("rejects different addresses", () => {
    expect(sameAddress("127.0.0.1", "127.0.0.2")).toBe(false);
    expect(sameAddress("::1", "127.0.0.1")).toBe(false);
    expect(sameAddress("bogus", "127.0.0.1")).toBe(false);
  });
});
