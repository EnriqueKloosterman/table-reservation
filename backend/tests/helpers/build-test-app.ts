import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { parseDuration, type Config } from "../../src/config/env.js";
import { fixedClock, type Clock } from "../../src/shared/clock.js";
import type { ReservationOps, ReservationTestHooks } from "../../src/modules/reservations/reservations.ops.js";
import type { RouteContext } from "../../src/shared/openapi/route.js";

export const TEST_JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";

/** Booking rules (feature 002); each defaults to the production default. */
export type TestBookingRules = {
  durationMinutes?: number;
  slotIntervalMinutes?: number;
  minNoticeMinutes?: number;
  horizonDays?: number;
};

export type BuildTestAppOptions = {
  timeZone?: string;
  bookingRules?: TestBookingRules;
  /** Runs after the guest claim and after the table claim of a reservation (test-only). */
  afterClaim?: ReservationTestHooks["afterClaim"];
  /** Replaces individual database operations of the reserve flow, to simulate failures. */
  reservationOps?: Partial<ReservationOps>;
  now?: Date | (() => Date);
  jwtSecret?: string;
  jwtExpiresIn?: string;
  isDatabaseUp?: () => boolean;
  configureTestRoutes?: (ctx: RouteContext) => void;
};

export function buildTestApp(options: BuildTestAppOptions = {}): Express {
  const jwtExpiresIn = options.jwtExpiresIn ?? "8h";
  const config: Config = {
    MONGODB_URI: "mongodb://unused-in-tests",
    JWT_SECRET: options.jwtSecret ?? TEST_JWT_SECRET,
    JWT_EXPIRES_IN: jwtExpiresIn,
    jwtExpiresInSeconds: parseDuration(jwtExpiresIn),
    RESTAURANT_TIME_ZONE: options.timeZone ?? "UTC",
    CORS_ORIGINS: ["http://localhost:5173"],
    PORT: 3000,
    RESERVATION_DURATION_MINUTES: options.bookingRules?.durationMinutes ?? 120,
    TIME_SLOT_INTERVAL_MINUTES: options.bookingRules?.slotIntervalMinutes ?? 15,
    MIN_NOTICE_MINUTES: options.bookingRules?.minNoticeMinutes ?? 60,
    BOOKING_HORIZON_DAYS: options.bookingRules?.horizonDays ?? 60,
  };

  let clock: Clock | undefined;
  const now = options.now;
  if (now instanceof Date) clock = fixedClock(now);
  else if (typeof now === "function") clock = { now };

  const testHooks: ReservationTestHooks | undefined =
    options.afterClaim || options.reservationOps
      ? {
          ...(options.afterClaim && { afterClaim: options.afterClaim }),
          ...(options.reservationOps && { ops: options.reservationOps }),
        }
      : undefined;

  return createApp({
    config,
    ...(testHooks && { testHooks }),
    ...(clock && { clock }),
    ...(options.isDatabaseUp && { isDatabaseUp: options.isDatabaseUp }),
    ...(options.configureTestRoutes && { configureTestRoutes: options.configureTestRoutes }),
  });
}
