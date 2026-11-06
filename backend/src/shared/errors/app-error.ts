export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export type FieldError = { field: string; reason: string };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function validationError(details: FieldError[]): AppError {
  return new AppError("VALIDATION_ERROR", "Request validation failed", details);
}

export function authenticationRequired(): AppError {
  return new AppError("AUTHENTICATION_REQUIRED", "Authentication required");
}

export function invalidCredentials(): AppError {
  return new AppError("INVALID_CREDENTIALS", "Invalid email or password");
}

export function notFound(message: string): AppError {
  return new AppError("NOT_FOUND", message);
}

export function conflict(message: string): AppError {
  return new AppError("CONFLICT", message);
}

export function serviceUnavailable(): AppError {
  return new AppError("SERVICE_UNAVAILABLE", "Service unavailable", { database: "down" });
}
