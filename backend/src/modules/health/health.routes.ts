import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { z } from "../../shared/openapi/zod.js";
import { createHealthController } from "./health.controller.js";

const HealthSchema = z
  .strictObject({ status: z.literal("ok"), database: z.literal("up") })
  .openapi("Health");

export function registerHealthRoutes(ctx: RouteContext, isDatabaseUp: () => boolean): void {
  const controller = createHealthController(isDatabaseUp);

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
    handler: controller.check,
  });
}
