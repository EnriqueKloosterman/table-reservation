import type { Notifier } from "../notifications/notifier.js";
import type { RouteContext, RouteHandler } from "../../shared/openapi/route.js";
import type { ReservationTestHooks } from "./reservations.ops.js";
import type { CreateReservationBodySchema } from "./reservations.schemas.js";
import { createReservation } from "./reservations.service.js";

export type ReservationsController = {
  create: RouteHandler<undefined, undefined, typeof CreateReservationBodySchema>;
};

/** HTTP handlers for the public reservation operation. */
export function createReservationsController(
  { config, clock }: Pick<RouteContext, "config" | "clock">,
  notifier: Notifier,
  testHooks?: ReservationTestHooks,
): ReservationsController {
  const deps = { config, clock, notifier, testHooks };
  return {
    create: async (_req, res) => {
      const confirmation = await createReservation(res.locals.input.body, deps);
      // No Location header: there is no read operation for a reservation yet.
      res.status(201).set("Cache-Control", "no-store").json(confirmation);
    },
  };
}
