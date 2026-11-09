import type { Notifier } from "../notifications/notifier.js";
import type { RouteContext, RouteHandler } from "../../shared/openapi/route.js";
import type { ReservationTestHooks } from "./reservations.ops.js";
import type {
  CancelBodySchema,
  CreateReservationBodySchema,
  ReservationIdParamsSchema,
  ReservationListQuerySchema,
} from "./reservations.schemas.js";
import { listDay } from "./reservations.read.service.js";
import { cancelReservation, createReservation } from "./reservations.service.js";

export type ReservationsController = {
  create: RouteHandler<undefined, undefined, typeof CreateReservationBodySchema>;
  cancelByCode: RouteHandler<undefined, undefined, typeof CancelBodySchema>;
  cancelByStaff: RouteHandler<typeof ReservationIdParamsSchema, undefined, undefined>;
  list: RouteHandler<undefined, typeof ReservationListQuerySchema, undefined>;
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
    cancelByCode: async (_req, res) => {
      const result = await cancelReservation({ by: "guest", code: res.locals.input.body.code }, deps);
      res.status(200).set("Cache-Control", "no-store").json(result);
    },
    cancelByStaff: async (_req, res) => {
      const result = await cancelReservation({ by: "staff", id: res.locals.input.params.id }, deps);
      res.status(200).set("Cache-Control", "no-store").json(result);
    },
    list: async (_req, res) => {
      const { date, status } = res.locals.input.query;
      const day = await listDay(date, status);
      // Personal data of guests: never cached.
      res.status(200).set("Cache-Control", "no-store").json(day);
    },
  };
}
