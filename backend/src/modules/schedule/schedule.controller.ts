import type { RouteHandler } from "../../shared/openapi/route.js";
import type { WeeklyScheduleSchema } from "./schedule.schemas.js";
import { getSchedule, replaceSchedule } from "./schedule.service.js";

export type ScheduleController = {
  get: RouteHandler<undefined, undefined, undefined>;
  replace: RouteHandler<undefined, undefined, typeof WeeklyScheduleSchema>;
};

/** HTTP handlers for the weekly schedule. */
export function createScheduleController(): ScheduleController {
  return {
    get: async (_req, res) => {
      res.json(await getSchedule());
    },

    replace: async (_req, res) => {
      res.json(await replaceSchedule(res.locals.input.body));
    },
  };
}
