import { AppError, type Logger } from "@nightwatch/shared";

const DENIAL_CODES = new Set(["MEMBERSHIP_DENIED", "PERMISSION_DENIED"]);

// Logs actor and action only, never the target organization or member data.
export async function auditDenials<T>(
  logger: Logger,
  actorUserId: string,
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError && DENIAL_CODES.has(error.code)) {
      logger.warn(
        { actorUserId, action, code: error.code },
        "organization access denied",
      );
    }
    throw error;
  }
}
