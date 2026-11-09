import { isValidObjectId } from "mongoose";
import type { Config } from "../../config/env.js";
import type { Clock } from "../../shared/clock.js";
import { invalidCredentials } from "../../shared/errors/app-error.js";
import type { AuthenticatedStaff } from "../../shared/middleware/require-auth.js";
import type { LoginRequest, LoginResponse } from "./auth.schemas.js";
import { DUMMY_HASH, verifyPassword } from "./password.js";
import { StaffMember } from "./staff.model.js";
import { signToken } from "./token.js";

export async function login(
  { email, password }: LoginRequest,
  { config, clock }: { config: Config; clock: Clock },
): Promise<LoginResponse> {
  const staff = await StaffMember.findOne({ email }).select("+passwordHash").lean();
  if (!staff) {
    await verifyPassword(password, DUMMY_HASH);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(password, staff.passwordHash))) throw invalidCredentials();

  const { token, expiresAt } = await signToken({
    staffId: staff._id.toHexString(),
    secret: config.JWT_SECRET,
    expiresInSeconds: config.jwtExpiresInSeconds,
    now: clock.now(),
  });
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    staff: { name: staff.name, email: staff.email },
  };
}

export async function findStaffById(id: string): Promise<AuthenticatedStaff | null> {
  if (!isValidObjectId(id)) return null;
  const staff = await StaffMember.findById(id).lean();
  return staff ? { id: staff._id.toHexString(), name: staff.name, email: staff.email } : null;
}
