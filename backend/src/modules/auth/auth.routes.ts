import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { createAuthController } from "./auth.controller.js";
import {
  LOGIN_EXAMPLE,
  LoginRequestSchema,
  LoginResponseSchema,
  StaffProfileSchema,
} from "./auth.schemas.js";

export function registerAuthRoutes(ctx: RouteContext): void {
  const controller = createAuthController(ctx);

  defineRoute(ctx, {
    method: "post",
    path: "/auth/login",
    summary: "Sign in",
    description:
      "Signs a staff member in with email and password. The email is trimmed and lowercased " +
      "before matching. Returns a bearer token and its UTC expiry. An unknown email and a " +
      "wrong password produce the same `INVALID_CREDENTIALS` refusal.",
    tags: ["Auth"],
    auth: false,
    request: { body: { schema: LoginRequestSchema, example: LOGIN_EXAMPLE } },
    success: { status: 200, description: "Signed in.", schema: LoginResponseSchema },
    errors: ["VALIDATION_ERROR", "INVALID_CREDENTIALS"],
    handler: controller.login,
  });

  defineRoute(ctx, {
    method: "get",
    path: "/auth/me",
    summary: "Get the signed-in staff member",
    description: "Returns the profile of the staff member the bearer token belongs to.",
    tags: ["Auth"],
    auth: true,
    success: { status: 200, description: "The signed-in staff member.", schema: StaffProfileSchema },
    errors: [],
    handler: controller.me,
  });
}
