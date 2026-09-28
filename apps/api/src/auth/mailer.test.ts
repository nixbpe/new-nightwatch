import { describe, expect, it } from "vitest";

import { senderAddress } from "./mailer";

describe("senderAddress", () => {
  it("keeps an address that already carries a display name", () => {
    expect(senderAddress("NightWatch Dev <noreply@nightwatch.local>")).toBe(
      "NightWatch Dev <noreply@nightwatch.local>",
    );
  });

  it("adds the product name to a bare address", () => {
    expect(senderAddress("noreply@nightwatch.local")).toEqual({
      name: "NightWatch",
      address: "noreply@nightwatch.local",
    });
  });

  it("passes an unset sender through", () => {
    expect(senderAddress(undefined)).toBeUndefined();
  });
});
