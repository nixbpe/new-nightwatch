import { authClient, authErrorMessage } from "../auth-client";

/** Personal (not tenant) data, so no organizationId in the key — like me/context. */
export const SESSIONS_QUERY_KEY = ["me", "sessions"] as const;

export type SessionRow = {
  id: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Every session signed in to the account, straight from better-auth. */
export async function fetchSessions(): Promise<SessionRow[]> {
  const { data, error } = await authClient.listSessions();
  if (error != null) {
    throw new Error(authErrorMessage(error, "โหลดรายการเซสชันไม่สำเร็จ"));
  }
  return data;
}

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
];

/** "2 ชั่วโมงที่แล้ว" / "เมื่อสักครู่" for a last-active timestamp. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) {
    return "เมื่อสักครู่";
  }
  const formatter = new Intl.RelativeTimeFormat("th", { numeric: "always" });
  for (const { unit, ms } of UNITS) {
    if (abs >= ms) {
      return formatter.format(Math.round(diff / ms), unit);
    }
  }
  return "เมื่อสักครู่";
}
