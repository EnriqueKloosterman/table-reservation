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
      "before matching. Returns a bearer token and its UTC expiry (`expiresAt`, equal to the " +
      "token's `exp` claim). Every well-formed request with an unknown email or a wrong " +
      "password gets the same `INVALID_CREDENTIALS` refusal; a syntactically invalid email or " +
      "an empty password is `VALIDATION_ERROR`, which reveals nothing about existing accounts. " +
      "Copy `token` into the Authorize dialog to call the protected operations.",
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
    description:
      "Returns the profile of the staff member the bearer token belongs to (never a password " +
      "or hash). A token whose staff account no longer exists is refused with 401.",
    tags: ["Auth"],
    auth: true,
    success: { status: 200, description: "The signed-in staff member.", schema: StaffProfileSchema },
    errors: [],
    handler: controller.me,
  });
}
