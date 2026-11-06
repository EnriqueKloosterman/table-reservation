import type { RequestHandler } from "express";
import type { Config } from "../../config/env.js";
import { findStaffById } from "../../modules/auth/auth.service.js";
import { verifyToken } from "../../modules/auth/token.js";
import type { Clock } from "../clock.js";
import { authenticationRequired } from "../errors/app-error.js";

export type AuthenticatedStaff = { id: string; name: string; email: string };

export type RequireAuthDeps = { config: Config; clock: Clock };

const BEARER = /^Bearer (\S+)$/;

/**
 * Requires a valid, unexpired HS256 bearer token for an existing staff member and stores
 * `{ id, name, email }` in `res.locals.staff`. Every refusal uses the same message.
 */
export function createRequireAuth({ config, clock }: RequireAuthDeps): RequestHandler {
  return async (req, res, next) => {
    const match = BEARER.exec(req.headers.authorization ?? "");
    if (!match) throw authenticationRequired();

    let staffId: string;
    try {
      ({ staffId } = await verifyToken(match[1]!, { secret: config.JWT_SECRET, now: clock.now() }));
    } catch {
      throw authenticationRequired();
    }

    const staff = await findStaffById(staffId);
    if (!staff) throw authenticationRequired();
    res.locals.staff = staff;
    next();
  };
}
