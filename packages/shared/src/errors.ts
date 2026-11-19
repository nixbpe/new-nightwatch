/**
 * Domain error carrying an HTTP `statusCode`, a machine-readable `code` and
 * a display-safe `message`. The API error handler maps AppError to the
 * api-contract error envelope; anything else becomes a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
