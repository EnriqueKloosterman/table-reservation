import { z } from "./zod.js";

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "INVALID_CREDENTIALS",
  "NOT_FOUND",
  "CONFLICT",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export const FieldErrorSchema = z
  .strictObject({
    field: z.string().openapi({ example: "capacity" }),
    reason: z.string().openapi({ example: "Too big: expected number to be <=50" }),
  })
  .openapi("FieldError");

export const ErrorResponseSchema = z
  .strictObject({
    error: z.strictObject({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z
        .union([
          z.array(FieldErrorSchema).min(1),
          z.strictObject({ database: z.literal("down") }),
        ])
        .openapi(
          {
            description:
              "Present only for VALIDATION_ERROR (non-empty array of field errors) and " +
              'SERVICE_UNAVAILABLE ({ "database": "down" }).',
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
