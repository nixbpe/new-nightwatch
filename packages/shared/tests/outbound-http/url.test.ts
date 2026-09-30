import { describe, expect, it } from "vitest";

import { findInvalidHeader } from "../../src/outbound-http/headers";
import { maskUrl, validateOutboundUrl } from "../../src/outbound-http/url";

const reason = (raw: string) => {
  const result = validateOutboundUrl(raw);
  return result.ok ? "ok" : result.reason;
};

describe("validateOutboundUrl", () => {
  it.each([
    "http://0x7f.1/",
    "http://2130706433/",
    "http://017700000001/",
    "http://127.1/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/",
    "http://localhost/",
    "http://LOCALHOST:8080/",
    "http://localhost./",
    "http://a.localhost/",
    "http://deep.a.localhost:8443/",
  ])("blocks %s", (url) => {
    expect(reason(url)).toBe("blocked_address");
  });

  it("accepts public hosts and public literals", () => {
    expect(reason("https://example.com/path?q=1")).toBe("ok");
    expect(reason("http://8.8.8.8/")).toBe("ok");
    expect(reason("https://[2606:4700:4700::1111]/")).toBe("ok");
  });

  it("rejects userinfo", () => {
    expect(reason("https://user:pw@example.com/")).toBe("userinfo_not_allowed");
    expect(reason("https://user@example.com/")).toBe("userinfo_not_allowed");
  });

  it("rejects schemes other than http and https", () => {
    expect(reason("ftp://example.com/")).toBe("unsupported_scheme");
    expect(reason("file:///etc/passwd")).toBe("unsupported_scheme");
  });

  it("accepts a 2048 character URL and rejects 2049", () => {
    const base = "https://example.com/";
    expect(reason(base + "a".repeat(2048 - base.length))).toBe("ok");
    expect(reason(base + "a".repeat(2049 - base.length))).toBe("url_too_long");
  });

  it.each([
    ["http://example.com:80/", "ok"],
    ["https://example.com:443/", "ok"],
    ["https://example.com:1024/", "ok"],
    ["https://example.com:65535/", "ok"],
    ["https://example.com:22/", "port_not_allowed"],
    ["https://example.com:1023/", "port_not_allowed"],
    ["https://example.com:8080/", "ok"],
    ["http://example.com:443/", "ok"],
    ["https://example.com:65536/", "invalid_url"],
  ])("port check %s is %s", (url, expected) => {
    expect(reason(url)).toBe(expected);
  });

  it("rejects text that is not a URL", () => {
    expect(reason("not a url")).toBe("invalid_url");
  });
});

describe("maskUrl", () => {
  it("masks values, keeps keys, and replaces a bare pair whole", () => {
    expect(maskUrl("https://example.com/p?token=abc&x=1&rawtoken")).toBe(
      "https://example.com/p?token=•••&x=•••&•••",
    );
  });

  it("masks an empty value and repeated names, keeping pair order and count", () => {
    expect(maskUrl("https://example.com/?a=&a=1&b=2&a=3&&c")).toBe(
      "https://example.com/?a=•••&a=•••&b=•••&a=•••&&•••",
    );
  });

  it("masks encoded values and bare pairs without decoding them", () => {
    expect(maskUrl("https://example.com/?q=%73ecret%26x&%72aw%3Dtoken")).toBe(
      "https://example.com/?q=•••&•••",
    );
  });

  it("leaves a URL without a query unchanged and drops fragment and userinfo", () => {
    expect(maskUrl("https://example.com/p")).toBe("https://example.com/p");
    expect(maskUrl("https://u:pw@example.com/p?a=1#frag")).toBe(
      "https://example.com/p?a=•••",
    );
  });

  it("masks the query of text that does not parse", () => {
    expect(maskUrl("//bad url?secret=1")).toBe("//bad url?•••");
  });
});

describe("findInvalidHeader", () => {
  it.each([
    "Host",
    "content-length",
    "Transfer-Encoding",
    "Connection",
    "Keep-Alive",
    "Upgrade",
    "TE",
    "Trailer",
    "Expect",
    "Proxy-Authorization",
    "proxy-connection",
  ])("rejects %s", (name) => {
    expect(findInvalidHeader({ [name]: "x" })).toBe(name);
  });

  it("rejects CR, LF and NUL in values and invalid names", () => {
    expect(findInvalidHeader({ "X-A": "a\r\nInjected: 1" })).toBe("X-A");
    expect(findInvalidHeader({ "X-A": "a\nb" })).toBe("X-A");
    expect(findInvalidHeader({ "X-A": "a\rb" })).toBe("X-A");
    expect(findInvalidHeader({ "X A": "a" })).toBe("X A");
  });

  it("accepts ordinary headers", () => {
    expect(
      findInvalidHeader({
        Authorization: "Bearer t",
        "X-Api-Key": "k",
        Accept: "*/*",
      }),
    ).toBeNull();
  });
});
