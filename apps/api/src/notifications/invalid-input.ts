import { AppError } from "@nightwatch/shared";

/** Converts route schema validation failures to the notification API contract. */
export const invalidInputHook = (result: { success: boolean }): undefined => {
  if (!result.success) {
    throw new AppError(400, "INVALID_INPUT", "Invalid request input");
  }
  return undefined;
};
