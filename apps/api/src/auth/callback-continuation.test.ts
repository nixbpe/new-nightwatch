import type { AuthEnv } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { extractInvitationContinuation } from "./index";

const authEnv = {
  APP_URL: "https://app.nightwatch.example",
} as AuthEnv;

function verifyUrlWithCallback(callbackURL: string): string {
  return `https://api.nightwatch.example/api/auth/verify-email?token=abc&callbackURL=${encodeURIComponent(callbackURL)}`;
}

describe("extractInvitationContinuation", () => {
  it("forwards the invitationId from a same-origin relative callbackURL", () => {
    expect(
      extractInvitationContinuation(
        authEnv,
        verifyUrlWithCallback("/onboarding?invitationId=inv_123"),
      ),
    ).toBe("inv_123");
  });

  it("forwards the invitationId from an absolute same-origin callbackURL", () => {
    expect(
      extractInvitationContinuation(
        authEnv,
        verifyUrlWithCallback(
          "https://app.nightwatch.example/onboarding?invitationId=inv-456_x",
        ),
      ),
    ).toBe("inv-456_x");
  });

  it("drops cross-origin callbackURLs", () => {
    expect(
      extractInvitationContinuation(
        authEnv,
        verifyUrlWithCallback(
          "https://evil.example/onboarding?invitationId=inv_1",
        ),
      ),
    ).toBeNull();
  });

  it("drops missing or malformed callbackURLs and unsafe invitationId values", () => {
    expect(extractInvitationContinuation(authEnv, "not-a-url")).toBeNull();
    expect(
      extractInvitationContinuation(
        authEnv,
        verifyUrlWithCallback("/onboarding"),
      ),
    ).toBeNull();
    expect(
      extractInvitationContinuation(
        authEnv,
        verifyUrlWithCallback(
          `/onboarding?invitationId=${encodeURIComponent("https://evil.example")}`,
        ),
      ),
    ).toBeNull();
  });
});
