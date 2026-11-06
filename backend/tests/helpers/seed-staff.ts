import { hashPassword } from "../../src/modules/auth/password.js";
import { StaffMember } from "../../src/modules/auth/staff.model.js";
import { normalizeEmail } from "../../src/shared/validation/normalize.js";

export const DEFAULT_STAFF = {
  name: "Ana",
  email: "ana@resto.com",
  password: "correct horse battery",
};

export type SeededStaff = { id: string; name: string; email: string; password: string };

export async function seedStaff({
  name = DEFAULT_STAFF.name,
  email = DEFAULT_STAFF.email,
  password = DEFAULT_STAFF.password,
}: Partial<typeof DEFAULT_STAFF> = {}): Promise<SeededStaff> {
  const doc = await StaffMember.create({
    name,
    email: normalizeEmail(email),
    passwordHash: await hashPassword(password),
  });
  return { id: doc._id.toHexString(), name: doc.name, email: doc.email, password };
}
