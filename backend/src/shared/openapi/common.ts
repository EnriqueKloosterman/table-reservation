import { AVAILABILITY_REASONS, CONFLICT_REASONS } from "../errors/app-error.js";
import { z } from "./zod.js";

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "INVALID_CREDENTIALS",
  "NOT_FOUND",
  "CONFLICT",
  "NO_AVAILABILITY",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const FieldErrorSchema = z
  .strictObject({
    field: z.string().openapi({ example: "capacity" }),
    reason: z.string().openapi({ example: "Too big: expected number to be <=50" }),
  })
  .openapi("FieldError");

export const AvailabilityReasonSchema = z.enum(AVAILABILITY_REASONS).openapi("AvailabilityReason", {
  description:
    "Why the requested time cannot be booked. When several reasons apply, the first in this " +
    "order is reported: too_soon, too_far_ahead, closed_date, closed_day, outside_service_hours, " +
    "party_too_large, no_table_free.",
});

export const ConflictReasonSchema = z.enum(CONFLICT_REASONS).openapi("ConflictReason", {
  description:
    "duplicate_reservation: the guest already holds an overlapping reservation. " +
    "table_has_upcoming_reservations: the table still has reservations that have not ended.",
});

export const ErrorResponseSchema = z
  .strictObject({
    error: z.strictObject({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z
        .union([
          z.array(FieldErrorSchema).min(1),
          z.strictObject({ database: z.literal("down") }),
          z.strictObject({ reason: AvailabilityReasonSchema }),
          z.strictObject({ reason: ConflictReasonSchema }),
        ])
        .openapi(
          {
            description:
              "Present only for VALIDATION_ERROR (non-empty array of field errors), " +
              'SERVICE_UNAVAILABLE ({ "database": "down" }), NO_AVAILABILITY ({ "reason": ' +
              "<availability reason> }) and some CONFLICT cases ({ \"reason\": <conflict reason> }).",
          },
          { unionPreferredType: "oneOf" },
        )
        .optional(),
    }),
  })
  .openapi("ErrorResponse", {
    example: {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ field: "capacity", reason: "Too big: expected number to be <=50" }],
      },
    },
  });

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
