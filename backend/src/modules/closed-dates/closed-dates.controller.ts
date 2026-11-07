import type { RouteContext, RouteHandler } from "../../shared/openapi/route.js";
import type {
  ClosedDateParamsSchema,
  CreateClosedDateSchema,
  ListClosedDatesQuerySchema,
} from "./closed-dates.schemas.js";
import { createClosedDate, listClosedDates, removeClosedDate } from "./closed-dates.service.js";

export type ClosedDatesController = {
  create: RouteHandler<undefined, undefined, typeof CreateClosedDateSchema>;
  list: RouteHandler<undefined, typeof ListClosedDatesQuerySchema, undefined>;
  remove: RouteHandler<typeof ClosedDateParamsSchema, undefined, undefined>;
};

/** HTTP handlers for closed dates. */
export function createClosedDatesController({
  config,
  clock,
}: Pick<RouteContext, "config" | "clock">): ClosedDatesController {
  const deps = { config, clock };
  return {
    create: async (_req, res) => {
      res.status(201).json(await createClosedDate(res.locals.input.body, deps));
    },

    list: async (_req, res) => {
      res.json(await listClosedDates(res.locals.input.query, deps));
    },

    remove: async (_req, res) => {
      await removeClosedDate(res.locals.input.params.date);
      res.status(204).end();
    },
  };
}
