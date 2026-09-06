/**
 * Domain error carrying a machine-readable `code`, an HTTP `statusCode` and a
 * display-safe `message`. The API error handler maps AppError to the
 * api-contract error envelope; anything else becomes a generic 500.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    statusCode = 500,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
