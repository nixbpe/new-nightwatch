import { afterEach, describe, expect, it } from "vitest";

import {
  normalizeReturnTo,
  readReturnTo,
  rememberReturnTo,
} from "./continuation";

const RETURN_TO_KEY = "nightwatch.auth.returnTo";

describe("auth return continuation", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it.each([
    ["workspace", "/workspace", "/workspace"],
    [
      "path with query and hash",
      "/settings/security?tab=2#sessions",
      "/settings/security?tab=2#sessions",
    ],
    ["canonical same-origin path", "/settings/../workspace", "/workspace"],
  ])("accepts a same-origin %s", (_case, input, expected) => {
    expect(normalizeReturnTo(input)).toBe(expected);
  });

  it.each([
    ["encoded backslashes", "/%5C%5Cevil.example"],
    ["literal backslash", "/\\evil.example"],
    ["protocol-relative URL", "//evil.example/path"],
    ["absolute scheme", "https://evil.example/path"],
    ["encoded control", "/workspace%0Aevil"],
    ["literal control", "/workspace\u0000evil"],
  ])("rejects a destination containing %s", (_case, input) => {
    expect(normalizeReturnTo(input)).toBe("/workspace");
  });

  it("persists only the safe fallback for an unsafe destination", () => {
    rememberReturnTo("/%5c%5cevil.example");

    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe("/workspace");
  });

  it("replaces an unsafe stored destination before returning it", () => {
    sessionStorage.setItem(RETURN_TO_KEY, "/%5C%5Cevil.example");

    expect(readReturnTo()).toBe("/workspace");
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe("/workspace");
  });
});
