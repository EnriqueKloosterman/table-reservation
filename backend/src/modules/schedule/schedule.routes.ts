import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { createScheduleController } from "./schedule.controller.js";
import { WEEKLY_SCHEDULE_EXAMPLE, WeeklyScheduleSchema } from "./schedule.schemas.js";

const TIME_NOTE =
  "Times are restaurant-local wall-clock values (HH:mm, 00:00–23:59) in the restaurant's " +
  "time zone; a period cannot cross midnight.";

export function registerScheduleRoutes(ctx: RouteContext): void {
  const controller = createScheduleController();

  defineRoute(ctx, {
    method: "get",
    path: "/schedule",
    summary: "Get the weekly schedule",
    description:
      "Returns the weekly service periods: all 7 days, Monday first, periods sorted by start. " +
      `Before any update every day has no periods (closed). ${TIME_NOTE}`,
    tags: ["Schedule"],
    auth: true,
    success: { status: 200, description: "The weekly schedule.", schema: WeeklyScheduleSchema },
    errors: [],
    handler: controller.get,
  });

  defineRoute(ctx, {
    method: "put",
    path: "/schedule",
    summary: "Replace the weekly schedule",
    description:
      "Replaces the whole schedule. Days may come in any order, each at most once; omitted " +
      "days are closed. Within a day, periods must not overlap (touching boundaries are " +
      "allowed) and names must be unique ignoring case. Any error refuses the whole update " +
      "and leaves the stored schedule unchanged; error indexes refer to the submitted " +
      `arrays. Returns the stored schedule in normalized form. ${TIME_NOTE}`,
    tags: ["Schedule"],
    auth: true,
    request: { body: { schema: WeeklyScheduleSchema, example: WEEKLY_SCHEDULE_EXAMPLE } },
    success: {
      status: 200,
      description: "The stored schedule, normalized (7 days, Monday first, periods sorted).",
      schema: WeeklyScheduleSchema,
    },
    errors: ["VALIDATION_ERROR"],
    handler: controller.replace,
  });
}
