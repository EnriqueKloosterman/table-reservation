import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { parseDuration, type Config } from "../../src/config/env.js";
import { fixedClock, type Clock } from "../../src/shared/clock.js";
import type { RouteContext } from "../../src/shared/openapi/route.js";

export const TEST_JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";

export type BuildTestAppOptions = {
  timeZone?: string;
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
  };

  let clock: Clock | undefined;
  const now = options.now;
  if (now instanceof Date) clock = fixedClock(now);
  else if (typeof now === "function") clock = { now };

  return createApp({
    config,
    ...(clock && { clock }),
    ...(options.isDatabaseUp && { isDatabaseUp: options.isDatabaseUp }),
    ...(options.configureTestRoutes && { configureTestRoutes: options.configureTestRoutes }),
  });
}
