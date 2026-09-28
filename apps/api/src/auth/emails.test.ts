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

  it("renders one HTML frame with a button, a fallback link and the link lifetime", () => {
    const mail = buildVerificationEmail(authEnv, "tok");
    const url =
      "https://app.nightwatch.example/onboarding?emailVerificationToken=tok";
    expect(mail.html).toContain('<html lang="th">');
    expect(mail.html).toContain('<meta name="color-scheme" content="light">');
    expect(mail.html).toContain(
      `<a href="${url}" style="display:inline-block;padding:12px 24px`,
    );
    expect(mail.html).toContain(`word-break:break-all">${url}</a>`);
    expect(mail.text).toContain("ลิงก์นี้ใช้ได้ 1 ชั่วโมง");
    expect(buildResetPasswordEmail(authEnv, "t").text).toContain(
      "ลิงก์นี้ใช้ได้ 1 ชั่วโมง",
    );
    expect(mail.subject).not.toContain("—");
  });

  it("names the inviter and role, escaped in HTML, and reads naturally without them", () => {
    const named = buildInvitationEmail(authEnv, {
      organizationName: "Acme",
      invitationId: "inv_1",
      inviterName: "<b>Mallory</b>",
      role: "admin",
    });
    expect(named.text).toContain(
      "<b>Mallory</b> เชิญคุณเข้าร่วมองค์กร Acme บน NightWatch ในบทบาทผู้ดูแล",
    );
    expect(named.html).toContain(
      "&lt;b&gt;Mallory&lt;/b&gt; เชิญคุณเข้าร่วมองค์กร <strong>Acme</strong> บน NightWatch ในบทบาทผู้ดูแล",
    );
    expect(named.html).not.toContain("<b>Mallory");
    expect(named.text).toContain("คำเชิญนี้ใช้ได้ 48 ชั่วโมง");

    const operator = buildInvitationEmail(authEnv, {
      organizationName: "Acme",
      invitationId: "inv_2",
      role: "owner",
    });
    expect(operator.text).toContain(
      "คุณได้รับเชิญให้เข้าร่วมองค์กร Acme บน NightWatch ในบทบาทเจ้าของ",
    );
  });
});
