import type { AuthEnv } from "@nightwatch/shared";

import type { OutboundMail } from "./mailer";

/**
 * Transactional auth email content (Thai product language). Links point at
 * the frontend origin (APP_URL); the API origin never appears in mail.
 */

/** Minimal HTML escaping for user-provided values interpolated into mail. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildVerificationEmail(
  authEnv: AuthEnv,
  token: string,
  invitationId?: string | null,
): OutboundMail {
  const continuation = invitationId
    ? `&invitationId=${encodeURIComponent(invitationId)}`
    : "";
  const url = `${authEnv.APP_URL}/onboarding?emailVerificationToken=${encodeURIComponent(token)}${continuation}`;
  return {
    to: "",
    subject: "ยืนยันอีเมลของคุณ — NightWatch",
    text:
      `ยินดีต้อนรับสู่ NightWatch\n\n` +
      `กรุณายืนยันอีเมลของคุณโดยเปิดลิงก์นี้:\n${url}\n\n` +
      `ลิงก์นี้มีอายุการใช้งานจำกัดและจะหมดอายุโดยอัตโนมัติ ` +
      `หากยืนยันอีเมลสำเร็จแล้ว การเปิดลิงก์ซ้ำจะไม่ส่งผลเพิ่มเติม ` +
      `หากคุณไม่ได้สมัครบัญชีนี้ สามารถเพิกเฉยได้`,
    html:
      `<p>ยินดีต้อนรับสู่ NightWatch</p>` +
      `<p>กรุณายืนยันอีเมลของคุณโดยเปิดลิงก์นี้:<br>` +
      `<a href="${url}">${url}</a></p>` +
      `<p>ลิงก์นี้มีอายุการใช้งานจำกัดและจะหมดอายุโดยอัตโนมัติ ` +
      `หากยืนยันอีเมลสำเร็จแล้ว การเปิดลิงก์ซ้ำจะไม่ส่งผลเพิ่มเติม ` +
      `หากคุณไม่ได้สมัครบัญชีนี้ สามารถเพิกเฉยได้</p>`,
  };
}

export function buildResetPasswordEmail(
  authEnv: AuthEnv,
  token: string,
): OutboundMail {
  const url = `${authEnv.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to: "",
    subject: "รีเซ็ตรหัสผ่าน NightWatch",
    text:
      `มีการร้องขอรีเซ็ตรหัสผ่านสำหรับบัญชี NightWatch ของคุณ\n\n` +
      `ตั้งรหัสผ่านใหม่ได้ที่:\n${url}\n\n` +
      `หากคุณไม่ได้ร้องขอ ไม่ต้องดำเนินการใดๆ รหัสผ่านเดิมยังคงใช้งานได้`,
    html:
      `<p>มีการร้องขอรีเซ็ตรหัสผ่านสำหรับบัญชี NightWatch ของคุณ</p>` +
      `<p>ตั้งรหัสผ่านใหม่ได้ที่:<br><a href="${url}">${url}</a></p>` +
      `<p>หากคุณไม่ได้ร้องขอ ไม่ต้องดำเนินการใดๆ รหัสผ่านเดิมยังคงใช้งานได้</p>`,
  };
}

export function buildInvitationEmail(
  authEnv: AuthEnv,
  input: { organizationName: string; invitationId: string },
): OutboundMail {
  const url = `${authEnv.APP_URL}/accept-invitation/${encodeURIComponent(input.invitationId)}`;
  const organizationNameHtml = escapeHtml(input.organizationName);
  return {
    to: "",
    subject: `คำเชิญเข้าร่วม ${input.organizationName} — NightWatch`,
    text:
      `คุณได้รับเชิญให้เข้าร่วมองค์กร ${input.organizationName} บน NightWatch\n\n` +
      `กรุณาเปิดลิงก์นี้เพื่อยอมรับคำเชิญ:\n${url}\n\n` +
      `คำเชิญนี้ใช้ได้กับอีเมลที่ได้รับเชิญเท่านั้น และจะหมดอายุโดยอัตโนมัติ`,
    html:
      `<p>คุณได้รับเชิญให้เข้าร่วมองค์กร ` +
      `<strong>${organizationNameHtml}</strong> บน NightWatch</p>` +
      `<p>กรุณาเปิดลิงก์นี้เพื่อยอมรับคำเชิญ:<br><a href="${url}">${url}</a></p>` +
      `<p>คำเชิญนี้ใช้ได้กับอีเมลที่ได้รับเชิญเท่านั้น และจะหมดอายุโดยอัตโนมัติ</p>`,
  };
}
