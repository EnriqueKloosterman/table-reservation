export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NO_AVAILABILITY"
  | "ALREADY_CANCELLED"
  | "CANNOT_CANCEL"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NO_AVAILABILITY: 409,
  ALREADY_CANCELLED: 409,
  CANNOT_CANCEL: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Why a requested time cannot be booked, in precedence order (research R7). */
export const AVAILABILITY_REASONS = [
  "too_soon",
  "too_far_ahead",
  "closed_date",
  "closed_day",
  "outside_service_hours",
  "party_too_large",
  "no_table_free",
] as const;
export type AvailabilityReason = (typeof AVAILABILITY_REASONS)[number];

/** Reasons carried by the new `CONFLICT` cases of feature 002. */
export const CONFLICT_REASONS = ["duplicate_reservation", "table_has_upcoming_reservations"] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

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

export function conflict(message: string, details?: { reason: ConflictReason }): AppError {
  return new AppError("CONFLICT", message, details);
}

export function noAvailability(reason: AvailabilityReason): AppError {
  return new AppError("NO_AVAILABILITY", "The requested time is not available", { reason });
}

export function alreadyCancelled(): AppError {
  return new AppError("ALREADY_CANCELLED", "The reservation is already cancelled");
}

export function cannotCancel(): AppError {
  return new AppError("CANNOT_CANCEL", "The reservation has already started or ended and cannot be cancelled");
}

export function serviceUnavailable(): AppError {
  return new AppError("SERVICE_UNAVAILABLE", "Service unavailable", { database: "down" });
}
