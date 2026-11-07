import { z } from "zod";

const DURATION_REGEX = /^(\d+)([smhd])$/;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** Parses a duration such as `"8h"`, `"30s"`, `"15m"` or `"2d"` into seconds. */
export function parseDuration(s: string): number {
  const match = DURATION_REGEX.exec(s);
  if (!match) throw new Error(`Invalid duration "${s}": expected <integer><s|m|h|d>`);
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A whole number written with digits only, within [min, max]; refuses "", "1.5", "-1", "1e2". */
function wholeNumber(min: number, max: number, defaultValue: number) {
  const message = `Must be a whole number between ${min} and ${max}`;
  return z
    .string()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().min(min, message).max(max, message))
    .default(defaultValue);
}

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(DURATION_REGEX).default("8h"),
  RESTAURANT_TIME_ZONE: z.string().refine(isValidTimeZone, "Must be a valid IANA time zone"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    )
    .pipe(z.array(z.url())),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Booking rules (feature 002, research R1): minutes, except BOOKING_HORIZON_DAYS.
  RESERVATION_DURATION_MINUTES: wholeNumber(15, 480, 120),
  TIME_SLOT_INTERVAL_MINUTES: wholeNumber(5, 120, 15),
  MIN_NOTICE_MINUTES: wholeNumber(0, 1440, 60),
  BOOKING_HORIZON_DAYS: wholeNumber(1, 365, 60),
});

export type Config = z.output<typeof EnvSchema> & { jwtExpiresInSeconds: number };

/** Thrown when the environment is invalid; `keys` lists every invalid key. */
export class ConfigError extends Error {
  readonly keys: string[];
  readonly issues: { key: string; message: string }[];

  constructor(issues: { key: string; message: string }[]) {
    const keys = [...new Set(issues.map((i) => i.key))];
    super(`Invalid configuration: ${keys.join(", ")}`);
    this.name = "ConfigError";
    this.keys = keys;
    this.issues = issues;
  }
}

/** Validates the environment and returns a typed config, or throws `ConfigError`. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        key: String(issue.path[0] ?? "(root)"),
        message: issue.message,
      })),
    );
  }
  return { ...result.data, jwtExpiresInSeconds: parseDuration(result.data.JWT_EXPIRES_IN) };
}
