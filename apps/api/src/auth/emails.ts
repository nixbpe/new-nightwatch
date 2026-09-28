import type { AuthEnv } from "@nightwatch/shared";

import type { OutboundMail } from "./mailer";

// Links point at APP_URL; the API origin never appears in mail.
// Lifetimes mirror the auth configuration: Better Auth defaults for the
// verification and reset tokens (3600 s), 48 hours for invitations.
const VERIFICATION_LINK_LIFETIME = "1 ชั่วโมง";
const RESET_LINK_LIFETIME = "1 ชั่วโมง";
const INVITATION_LIFETIME = "48 ชั่วโมง";

// Same labels as apps/web/src/lib/roles.ts; the API cannot import the web app.
const ROLE_LABELS: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "ผู้ดูแล",
  viewer: "ผู้ชม",
  auditor: "ผู้ตรวจสอบ",
};

const FOOTER = "ข้อความนี้ส่งอัตโนมัติจากระบบ NightWatch";

// Light-theme tokens from docs/design-system.md; mail clients get no dark
// variant, so the head pins the light color scheme.
const COLOR = {
  canvas: "#f7f8fa",
  surface: "#ffffff",
  text: "#171a1f",
  secondary: "#5b6470",
  primary: "#087a55",
  onPrimary: "#ffffff",
  // Text at 10% over Surface, flattened to hex: mail clients skip rgba().
  divider: "#e8e8e9",
};
const FONT =
  "-apple-system, 'Segoe UI', Roboto, 'Noto Sans Thai', Inter, sans-serif";

type EmailContent = {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  // Escaped HTML for the intro when it needs emphasis; defaults to escaped `intro`.
  introHtml?: string;
  action: { label: string; url: string };
  note: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderText(content: EmailContent): string {
  return [
    content.heading,
    "",
    content.intro,
    "",
    `${content.action.label}:`,
    content.action.url,
    "",
    content.note,
    "",
    FOOTER,
  ].join("\n");
}

function renderHtml(content: EmailContent): string {
  const url = escapeHtml(content.action.url);
  const intro = content.introHtml ?? escapeHtml(content.intro);
  const cell = (style: string, body: string) =>
    `<tr><td style="${style}">${body}</td></tr>`;
  return (
    `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width">` +
    `<meta name="color-scheme" content="light">` +
    `<meta name="supported-color-schemes" content="light">` +
    `<title>${escapeHtml(content.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${COLOR.canvas}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.canvas};padding:32px 16px">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLOR.surface};border-radius:4px;padding:32px 24px;font-family:${FONT};font-size:16px;line-height:1.6;color:${COLOR.text}">` +
    cell(
      "padding-bottom:24px",
      `<span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:4px;background:${COLOR.primary};color:${COLOR.onPrimary};font-weight:600;text-align:center;vertical-align:middle">N</span>` +
        `<span style="display:inline-block;margin-left:10px;font-weight:600;vertical-align:middle">NightWatch</span>`,
    ) +
    cell(
      "padding-bottom:12px;font-size:20px;font-weight:600;line-height:1.4",
      escapeHtml(content.heading),
    ) +
    cell("padding-bottom:24px", intro) +
    cell(
      "padding-bottom:24px",
      `<a href="${url}" style="display:inline-block;padding:12px 24px;border-radius:4px;background:${COLOR.primary};color:${COLOR.onPrimary};font-weight:600;line-height:20px;text-decoration:none">${escapeHtml(content.action.label)}</a>`,
    ) +
    cell(
      `padding-bottom:24px;font-size:14px;color:${COLOR.secondary}`,
      `ถ้าปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br>` +
        `<a href="${url}" style="color:${COLOR.primary};word-break:break-all">${url}</a>`,
    ) +
    cell(
      `padding-top:24px;border-top:1px solid ${COLOR.divider};font-size:14px;color:${COLOR.secondary}`,
      escapeHtml(content.note),
    ) +
    `</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    cell(
      `padding:16px 24px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLOR.secondary};text-align:center`,
      escapeHtml(FOOTER),
    ) +
    `</table></td></tr></table></body></html>`
  );
}

function buildMail(content: EmailContent): OutboundMail {
  return {
    to: "",
    subject: content.subject,
    text: renderText(content),
    html: renderHtml(content),
  };
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
  return buildMail({
    subject: "NightWatch: ยืนยันอีเมลของคุณ",
    preheader: `ลิงก์ยืนยันอีเมลใช้ได้ ${VERIFICATION_LINK_LIFETIME}`,
    heading: "ยินดีต้อนรับสู่ NightWatch",
    intro:
      "กดปุ่มด้านล่างเพื่อยืนยันว่าอีเมลนี้เป็นของคุณ แล้วเริ่มใช้งานบัญชีได้ทันที",
    action: { label: "ยืนยันอีเมล", url },
    note:
      `ลิงก์นี้ใช้ได้ ${VERIFICATION_LINK_LIFETIME} หากยืนยันแล้ว การเปิดลิงก์ซ้ำจะไม่มีผลเพิ่มเติม ` +
      "หากคุณไม่ได้สมัครบัญชีนี้ ไม่ต้องดำเนินการใดๆ",
  });
}

export function buildResetPasswordEmail(
  authEnv: AuthEnv,
  token: string,
): OutboundMail {
  const url = `${authEnv.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return buildMail({
    subject: "NightWatch: รีเซ็ตรหัสผ่าน",
    preheader: `ลิงก์ตั้งรหัสผ่านใหม่ใช้ได้ ${RESET_LINK_LIFETIME}`,
    heading: "ตั้งรหัสผ่านใหม่",
    intro:
      "มีการร้องขอรีเซ็ตรหัสผ่านสำหรับบัญชี NightWatch ของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่",
    action: { label: "ตั้งรหัสผ่านใหม่", url },
    note:
      `ลิงก์นี้ใช้ได้ ${RESET_LINK_LIFETIME} หากคุณไม่ได้ร้องขอ ไม่ต้องดำเนินการใดๆ ` +
      "รหัสผ่านเดิมยังใช้งานได้ตามปกติ",
  });
}

export function buildInvitationEmail(
  authEnv: AuthEnv,
  input: {
    organizationName: string;
    invitationId: string;
    inviterName?: string | null;
    role?: string | null;
  },
): OutboundMail {
  const url = `${authEnv.APP_URL}/accept-invitation/${encodeURIComponent(input.invitationId)}`;
  const organization = input.organizationName;
  const roleLabel = input.role ? (ROLE_LABELS[input.role] ?? input.role) : null;
  const roleText = roleLabel ? ` ในบทบาท${roleLabel}` : "";
  const inviter = input.inviterName?.trim() || null;
  const intro = inviter
    ? `${inviter} เชิญคุณเข้าร่วมองค์กร ${organization} บน NightWatch${roleText}`
    : `คุณได้รับเชิญให้เข้าร่วมองค์กร ${organization} บน NightWatch${roleText}`;
  const introHtml = inviter
    ? `${escapeHtml(inviter)} เชิญคุณเข้าร่วมองค์กร <strong>${escapeHtml(organization)}</strong> บน NightWatch${escapeHtml(roleText)}`
    : `คุณได้รับเชิญให้เข้าร่วมองค์กร <strong>${escapeHtml(organization)}</strong> บน NightWatch${escapeHtml(roleText)}`;
  return buildMail({
    subject: `NightWatch: คำเชิญเข้าร่วม ${organization}`,
    preheader: `คำเชิญนี้ใช้ได้ ${INVITATION_LIFETIME}`,
    heading: `คุณได้รับเชิญเข้าร่วม ${organization}`,
    intro,
    introHtml,
    action: { label: "ยอมรับคำเชิญ", url },
    note:
      `คำเชิญนี้ใช้ได้ ${INVITATION_LIFETIME} และใช้ได้กับอีเมลที่ได้รับเชิญเท่านั้น ` +
      "หากคุณไม่รู้จักองค์กรนี้ ไม่ต้องดำเนินการใดๆ",
  });
}
