import { z } from "zod";
import { normalizeEmail } from "../../shared/validation/normalize.js";
import { hashPassword } from "./password.js";
import { StaffMember } from "./staff.model.js";

/** Thrown when the provisioning environment is invalid. Never carries the values. */
export class ProvisionConfigError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(`Invalid staff provisioning configuration: ${keys.join(", ")}`);
    this.name = "ProvisionConfigError";
    this.keys = keys;
  }
}

const ProvisionEnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  STAFF_NAME: z.string().trim().min(1).max(100),
  STAFF_EMAIL: z.string().transform(normalizeEmail).pipe(z.email()),
  STAFF_PASSWORD: z.string().min(1).max(1024),
});

export type ProvisionInput = { name: string; email: string; password: string };

export function parseProvisionEnv(
  env: Record<string, string | undefined> = process.env,
): ProvisionInput & { mongoUri: string } {
  const result = ProvisionEnvSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new ProvisionConfigError(keys);
  }
  const { MONGODB_URI, STAFF_NAME, STAFF_EMAIL, STAFF_PASSWORD } = result.data;
  return { mongoUri: MONGODB_URI, name: STAFF_NAME, email: STAFF_EMAIL, password: STAFF_PASSWORD };
}

/**
 * Creates the staff account, or leaves an existing one with the same email untouched.
 * Uniqueness is decided by the unique index (duplicate key → "exists"), never read-then-write.
 */
export async function provisionStaff({
  name,
  email,
  password,
}: ProvisionInput): Promise<"created" | "exists"> {
  try {
    await StaffMember.create({ name, email, passwordHash: await hashPassword(password) });
    return "created";
  } catch (err) {
    if ((err as { code?: unknown }).code === 11000) return "exists";
    throw err;
  }
}
