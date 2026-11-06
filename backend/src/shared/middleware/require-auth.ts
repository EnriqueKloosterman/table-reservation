import type { RequestHandler } from "express";
import type { Config } from "../../config/env.js";
import type { Clock } from "../clock.js";
import { authenticationRequired } from "../errors/app-error.js";

export type AuthenticatedStaff = { id: string; name: string; email: string };

export type RequireAuthDeps = { config: Config; clock: Clock };

/**
 * Fail-closed placeholder: refuses every request until real JWT verification lands (US1).
 */
export function createRequireAuth(_deps: RequireAuthDeps): RequestHandler {
  return () => {
    throw authenticationRequired();
  };
}
