import type { RouteContext, RouteHandler } from "../../shared/openapi/route.js";
import type { LoginRequestSchema } from "./auth.schemas.js";
import { login } from "./auth.service.js";

export type AuthController = {
  login: RouteHandler<undefined, undefined, typeof LoginRequestSchema>;
  me: RouteHandler<undefined, undefined, undefined>;
};

/** HTTP handlers for sign-in and the signed-in profile. */
export function createAuthController({
  config,
  clock,
}: Pick<RouteContext, "config" | "clock">): AuthController {
  return {
    login: async (_req, res) => {
      res.json(await login(res.locals.input.body, { config, clock }));
    },

    me: (_req, res) => {
      const { name, email } = res.locals.staff;
      res.json({ name, email });
    },
  };
}
