import type { RouteContext, RouteHandler } from "../../shared/openapi/route.js";
import type { AvailabilityQuerySchema, TimesQuerySchema } from "./availability.schemas.js";
import { checkAvailabilityFor, listTimesFor } from "./availability.service.js";

export type AvailabilityController = {
  check: RouteHandler<undefined, typeof AvailabilityQuerySchema, undefined>;
  times: RouteHandler<undefined, typeof TimesQuerySchema, undefined>;
};

/** HTTP handlers for the public availability lookups. */
export function createAvailabilityController({
  config,
  clock,
}: Pick<RouteContext, "config" | "clock">): AvailabilityController {
  const deps = { config, clock };
  return {
    check: async (_req, res) => {
      const answer = await checkAvailabilityFor(res.locals.input.query, deps);
      res.set("Cache-Control", "no-store").json(answer);
    },

    times: async (_req, res) => {
      const answer = await listTimesFor(res.locals.input.query, deps);
      res.set("Cache-Control", "no-store").json(answer);
    },
  };
}
