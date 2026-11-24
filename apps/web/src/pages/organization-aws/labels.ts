import type { AwsTestFailureCode } from "@nightwatch/api-contract";

// Fixed Thai reasons per code: the API never forwards AWS text, and neither does the page (AC-03).
export const FAILURE_REASONS: Record<AwsTestFailureCode, string> = {
  AWS_ACCESS_DENIED:
    "AWS ปฏิเสธการ assume role ตรวจ Role ARN, trust policy และ External ID ในบัญชีกลาง",
  AWS_REGION_DISABLED: "ภูมิภาคที่ใช้ทดสอบถูกปิดอยู่ในบัญชีนี้",
  AWS_TIMEOUT: "AWS ไม่ตอบภายในเวลาที่กำหนด ลองทดสอบใหม่",
  AWS_UNKNOWN: "ทดสอบไม่สำเร็จโดยไม่ทราบสาเหตุ ลองทดสอบใหม่",
  AWS_ACCOUNT_MISMATCH: "บัญชีที่ AWS ยืนยันไม่ตรงกับบัญชีใน Role ARN",
};

export const ROLE_ARN_FORMAT_ERROR =
  "Role ARN ต้องอยู่ในรูปแบบ arn:aws:iam::<เลขบัญชี 12 หลัก>:role/<ชื่อ role>";

export const DENIED_MESSAGES = {
  MEMBERSHIP_DENIED: "คุณไม่ใช่สมาชิกขององค์กรนี้",
  PERMISSION_DENIED: "เฉพาะเจ้าของและผู้ดูแลองค์กรจัดการการเชื่อมต่อ AWS ได้",
} as const;
export type DeniedCode = keyof typeof DENIED_MESSAGES;

export const SETUP_STEPS_ID = "aws-setup-steps";
