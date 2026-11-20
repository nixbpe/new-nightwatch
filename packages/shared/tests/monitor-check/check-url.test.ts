import { describe, expect, it } from "vitest";

import { buildCheckUrl } from "../../src/monitor-check";
import { validateOutboundUrl } from "../../src/outbound-http";

const href = (url: string, params: { name: string; value: string }[] = []) => {
  const built = buildCheckUrl(url, params);
  return built.ok ? built.url.href : built.reason;
};

describe("buildCheckUrl", () => {
  it("starts a query when the saved url has none and keeps the fragment", () => {
    expect(href("https://example.com/p#top", [{ name: "k", value: "v" }])).toBe(
      "https://example.com/p?k=v#top",
    );
  });

  it("counts a fragment toward the 2048 limit", () => {
    const params = [{ name: "k", value: "v".repeat(40) }];
    const withFragment = `https://example.com/#${"f".repeat(2000)}`;
    expect(validateOutboundUrl(withFragment).ok).toBe(true);
    expect(href("https://example.com/", params).length).toBeLessThan(100);
    expect(href(withFragment, params)).toBe("url_too_long");
  });

  it("validates the normalized href even without params", () => {
    const raw = `https://example.com/${"a b".repeat(500)}`;
    expect(raw.length).toBeLessThanOrEqual(2048);
    expect(href(raw)).toBe("url_too_long");
  });

  it.each([
    ["ftp://example.com/", "unsupported_scheme"],
    ["https://u:p@example.com/", "userinfo_not_allowed"],
    ["http://127.0.0.1/", "blocked_address"],
  ])("rejects %s", (url, reason) => {
    expect(href(url, [{ name: "k", value: "v" }])).toBe(reason);
  });
});
