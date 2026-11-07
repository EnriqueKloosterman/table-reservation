import { z } from "../../shared/openapi/zod.js";

export const LoginRequestSchema = z
  .strictObject({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email())
      .openapi({ description: "Trimmed and lowercased, then checked as an email address." }),
    password: z.string().min(1).max(1024),
  })
  .openapi("LoginRequest");

export const LOGIN_EXAMPLE = { email: " Ana@Resto.com ", password: "correct horse battery" };

export const StaffProfileSchema = z
  .object({
    name: z.string().openapi({ example: "Ana" }),
    email: z.string().openapi({ example: "ana@resto.com" }),
  })
  .openapi("StaffProfile");

export const LoginResponseSchema = z
  .object({
    token: z.string().openapi({ description: "HS256 JWT. Send as `Authorization: Bearer <token>`." }),
    expiresAt: z.iso.datetime().openapi({
      description: "UTC instant when the token expires (equals the token's `exp` claim).",
      example: "2026-11-06T18:00:00.000Z",
    }),
    staff: StaffProfileSchema,
  })
  .openapi("LoginResponse");

export type LoginRequest = z.output<typeof LoginRequestSchema>;
export type LoginResponse = z.output<typeof LoginResponseSchema>;
