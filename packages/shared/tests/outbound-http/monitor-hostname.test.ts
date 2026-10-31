import { describe, expect, it } from "vitest";
import { monitorHostname } from "../../src/outbound-http";

describe("monitorHostname", () => {
  it.each([
    [
      "https://user:secret@CDN.Example.COM.:8443/private?token=secret#fragment",
      "cdn.example.com",
    ],
    ["https://bücher.example/", "xn--bcher-kva.example"],
    ["https://127.0.0.1/", null],
    ["https://2130706433/", null],
    ["https://0x7f.1/", null],
    ["https://[2001:db8::1]/", null],
    ["invalid", null],
    ["file:///tmp/a", null],
    [`https://${"a".repeat(254)}`, null],
  ])("extracts only a normalized DNS hostname from %s", (input, expected) => {
    expect(monitorHostname(input)).toBe(expected);
  });
});
