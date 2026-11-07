import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { createAvailabilityController } from "./availability.controller.js";
import { AvailabilityQuerySchema, AvailabilityResponseSchema } from "./availability.schemas.js";

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
}
