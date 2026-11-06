import { serviceUnavailable } from "../../shared/errors/app-error.js";
import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { z } from "../../shared/openapi/zod.js";

const HealthSchema = z
  .strictObject({ status: z.literal("ok"), database: z.literal("up") })
  .openapi("Health");

export function registerHealthRoutes(ctx: RouteContext, isDatabaseUp: () => boolean): void {
  defineRoute(ctx, {
    method: "get",
    path: "/health",
    summary: "Check service health",
    description:
      "Public health check. Returns 200 when the service and its database are up, and " +
      '503 SERVICE_UNAVAILABLE with `details: { "database": "down" }` when the database is ' +
      "not connected.",
    tags: ["Health"],
    auth: false,
    success: { status: 200, description: "The service and database are up.", schema: HealthSchema },
    errors: ["SERVICE_UNAVAILABLE"],
    handler: (_req, res) => {
      if (!isDatabaseUp()) throw serviceUnavailable();
      res.json({ status: "ok", database: "up" });
    },
  });
}
