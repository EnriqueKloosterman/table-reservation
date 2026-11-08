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

/** `a@b.c` or `Name <a@b.c>`; no CR/LF can match any part of it. */
const MAILBOX = /^(?:[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+|[^<>\r\n]+<[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+>)$/;

const EnvObject = z.object({
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
  // Confirmation and cancellation emails (feature 003, research R10).
  // An empty SMTP_URL counts as unset. It may hold credentials: it is never logged.
  SMTP_URL: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v))
    .pipe(z.url({ protocol: /^smtps?$/, message: "Must be a smtp:// or smtps:// URL" }).optional()),
  EMAIL_FROM: z.string().optional(),
  EMAIL_TIMEOUT_MS: wholeNumber(100, 120000, 10000),
  RESTAURANT_NAME: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\r\n]*$/, "Must not contain line breaks")
    .default("the restaurant"),
  CANCEL_LINK_BASE_URL: z
    .url({ protocol: /^https?$/, message: "Must be an http(s) URL" })
    .refine((u) => !u.includes("#"), "Must not contain a fragment")
    .default("http://localhost:5173/cancel"),
});

/** EMAIL_FROM is required (and must be a valid mailbox) only when SMTP_URL is set. */
const EnvSchema = EnvObject.superRefine((env, ctx) => {
  if (env.SMTP_URL === undefined) return;
  if (env.EMAIL_FROM === undefined || !MAILBOX.test(env.EMAIL_FROM)) {
    ctx.addIssue({
      code: "custom",
      path: ["EMAIL_FROM"],
      message: "Required with SMTP_URL: an address such as a@b.c or Name <a@b.c>",
    });
  }
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
