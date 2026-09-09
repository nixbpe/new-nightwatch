import type { AuthEnv } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import {
  buildInvitationEmail,
  buildResetPasswordEmail,
  buildVerificationEmail,
} from "./emails";

const authEnv = {
  APP_URL: "https://app.nightwatch.example",
} as AuthEnv;

describe("auth email builders", () => {
  it("points verification at /onboarding with the token and optional continuation", () => {
    const plain = buildVerificationEmail(authEnv, "tok/+=?");
    expect(plain.to).toBe("");
    expect(plain.subject).toContain("ยืนยันอีเมล");
    expect(plain.text).toContain(
      "https://app.nightwatch.example/onboarding?emailVerificationToken=tok%2F%2B%3D%3F",
    );

    const continued = buildVerificationEmail(authEnv, "tok2", "inv_9");
    expect(continued.text).toContain(
      "https://app.nightwatch.example/onboarding?emailVerificationToken=tok2&invitationId=inv_9",
    );
  });

  it("points password reset at /reset-password?token= for the UI route", () => {
    const mail = buildResetPasswordEmail(authEnv, "reset/token+=");
    expect(mail.subject).toContain("รีเซ็ตรหัสผ่าน");
    expect(mail.text).toContain(
      "https://app.nightwatch.example/reset-password?token=reset%2Ftoken%2B%3D",
    );
    expect(mail.text).not.toContain("/reset-password/reset");
  });

  it("points invitations at /accept-invitation/:id and never at the API origin", () => {
    const mail = buildInvitationEmail(authEnv, {
      organizationName: "Acme <Corp> & Co",
      invitationId: "inv_7",
    });
    expect(mail.subject).toContain("Acme <Corp> & Co");
    expect(mail.text).toContain(
      "https://app.nightwatch.example/accept-invitation/inv_7",
    );
    expect(mail.text).not.toContain("api.nightwatch.example");
    // User-provided name must not break out of the HTML body.
    expect(mail.html).toContain("Acme &lt;Corp&gt; &amp; Co");
    expect(mail.html).not.toContain("<Acme");
  });
});
