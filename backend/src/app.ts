import cors from "cors";
import express, { type Express } from "express";
import type { Config } from "./config/env.js";
import { isDatabaseUp as defaultIsDatabaseUp } from "./db/connection.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerAvailabilityRoutes } from "./modules/availability/availability.routes.js";
import { registerClosedDateRoutes } from "./modules/closed-dates/closed-dates.routes.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { createEmailSender, type EmailSender } from "./modules/notifications/email-sender.js";
import { createNotifier, type Notifier } from "./modules/notifications/notifier.js";
import type { ReservationTestHooks } from "./modules/reservations/reservations.ops.js";
import { registerReservationRoutes } from "./modules/reservations/reservations.routes.js";
import { registerScheduleRoutes } from "./modules/schedule/schedule.routes.js";
import { registerTableRoutes } from "./modules/tables/tables.routes.js";
import { systemClock, type Clock } from "./shared/clock.js";
import { errorMiddleware } from "./shared/errors/error-middleware.js";
import { notFoundMiddleware } from "./shared/errors/not-found.js";
import { createRequireAuth } from "./shared/middleware/require-auth.js";
import { registerDocsRoutes } from "./shared/openapi/document.js";
import { createRegistry } from "./shared/openapi/registry.js";
import type { RouteContext } from "./shared/openapi/route.js";

export type CreateAppOptions = {
  config: Config;
  clock?: Clock;
  isDatabaseUp?: () => boolean;
  /** Test-only hook to mount extra routes before the 404 fallback. */
  configureTestRoutes?: (ctx: RouteContext) => void;
  /** Test-only hooks of the reserve flow. Only `buildTestApp` passes them; `server.ts` never does. */
  testHooks?: ReservationTestHooks;
  /** Test-only: replaces the SMTP / no-op sender chosen from the configuration. */
  emailSender?: EmailSender;
  /** Test-only: receives the notifier, so tests can wait for pending emails with `idle()`. */
  onNotifier?: (notifier: Notifier) => void;
};

export function createApp({
  config,
  clock = systemClock,
  isDatabaseUp = defaultIsDatabaseUp,
  configureTestRoutes,
  testHooks,
  emailSender,
  onNotifier,
}: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  const corsMiddleware = cors({
    origin: config.CORS_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: false,
  });
  app.use(corsMiddleware);
  app.options(/.*/, corsMiddleware);

  // No global body parser: bodies are parsed per route by `jsonBody()`, after auth.
  const router = express.Router();
  const ctx: RouteContext = {
    router,
    registry: createRegistry(),
    requireAuth: createRequireAuth({ config, clock }),
    config,
    clock,
  };

  registerHealthRoutes(ctx, isDatabaseUp);
  // register module routes here (US1–US4)
  registerAuthRoutes(ctx);
  registerTableRoutes(ctx);
  registerScheduleRoutes(ctx);
  registerClosedDateRoutes(ctx);
  registerAvailabilityRoutes(ctx);
  const notifier = createNotifier(emailSender ?? createEmailSender(config, clock), config, clock);
  onNotifier?.(notifier);
  registerReservationRoutes(ctx, notifier, testHooks);
  configureTestRoutes?.(ctx);
  registerDocsRoutes(ctx);

  app.use(router);
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}
