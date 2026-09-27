import { authClient, authErrorMessage } from "../auth-client";

// Personal (not tenant) data, so no organizationId in the key.
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

export async function fetchSessions(): Promise<SessionRow[]> {
  const { data, error } = await authClient.listSessions();
  if (error != null) {
    throw new Error(authErrorMessage(error, "โหลดรายการเซสชันไม่สำเร็จ"));
  }
  return data;
}
