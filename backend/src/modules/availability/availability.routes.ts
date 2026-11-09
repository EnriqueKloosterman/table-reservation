import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { createAvailabilityController } from "./availability.controller.js";
import {
  AvailabilityQuerySchema,
  AvailabilityResponseSchema,
  TimesQuerySchema,
  TimesResponseSchema,
} from "./availability.schemas.js";

const TAGS = ["Availability"];

const REASON_ORDER =
  "When several reasons apply, the first in this order is reported: `too_soon`, " +
  "`too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, `party_too_large`, " +
  "`no_table_free`.";

export function registerAvailabilityRoutes(ctx: RouteContext): void {
  const controller = createAvailabilityController(ctx);

  defineRoute(ctx, {
    method: "get",
    path: "/availability",
    summary: "Check whether a party can be seated",
    description:
      "Public — no sign-in required. Answers whether a party of `partySize` can start a " +
      "reservation at `time` on `date` (restaurant-local), with a `reason` when it cannot. " +
      "`reason` is present if and only if `available` is false, and the table that would be " +
      `assigned is never revealed. ${REASON_ORDER} A party larger than every table is ` +
      "`party_too_large`, not a validation error. The answer is a snapshot and is not " +
      "cacheable (`Cache-Control: no-store`); a later reservation request can still be refused.",
    tags: TAGS,
    auth: false,
    request: { query: AvailabilityQuerySchema },
    success: {
      status: 200,
      description: "The answer for the requested date, time and party size.",
      schema: AvailabilityResponseSchema,
    },
    errors: ["VALIDATION_ERROR"],
    handler: controller.check,
  });

  defineRoute(ctx, {
    method: "get",
    path: "/availability/times",
    summary: "List bookable times for a date",
    description:
      "Public — no sign-in required. Lists the start times at which a party of `partySize` " +
      "can currently reserve on `date`, grouped by service period under the stored period " +
      "names, in chronological order; periods without a bookable time are omitted. Times are " +
      "generated at a fixed interval from the start of each period up to the last start that " +
      "still ends by the period end, and only times that pass every availability rule are " +
      "listed, so each listed time is accepted by `GET /availability` and `POST " +
      "/reservations` if nothing changed in between. A non-empty list carries no `reason`; " +
      "an empty one carries exactly one, chosen in this order: `too_soon` (date before " +
      "today), `too_far_ahead`, `closed_date`, `closed_day`, `party_too_large`; then " +
      "`outside_service_hours` if no service period is long enough for a reservation; then " +
      "`too_soon` if the minimum notice rules out every remaining time; otherwise " +
      "`no_table_free`. The answer is a snapshot and is not cacheable (`Cache-Control: no-store`).",
    tags: TAGS,
    auth: false,
    request: { query: TimesQuerySchema },
    success: {
      status: 200,
      description: "Bookable times grouped by service period, or an empty list with a reason.",
      schema: TimesResponseSchema,
    },
    errors: ["VALIDATION_ERROR"],
    handler: controller.times,
  });
}
