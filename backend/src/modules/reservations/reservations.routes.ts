import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { createReservationsController } from "./reservations.controller.js";
import type { ReservationTestHooks } from "./reservations.ops.js";
import {
  CREATE_RESERVATION_EXAMPLE,
  CreateReservationBodySchema,
  ReservationConfirmationSchema,
} from "./reservations.schemas.js";

const TAGS = ["Reservations"];

export function registerReservationRoutes(ctx: RouteContext, testHooks?: ReservationTestHooks): void {
  const controller = createReservationsController(ctx, testHooks);

  defineRoute(ctx, {
    method: "post",
    path: "/reservations",
    summary: "Reserve a table as a guest",
    description:
      "Public — no sign-in required. Creates a confirmed reservation for a guest and assigns " +
      "the most suitable free table automatically (smallest capacity that seats the party, " +
      "then name in natural order); the guest cannot choose it. The response carries the " +
      "details, the assigned table name and a `secretCode` that is shown only here and is " +
      "never returned again. Refusal order: validation (400), duplicate reservation (409 " +
      "`CONFLICT` with `details.reason` `duplicate_reservation`: the same email, trimmed and " +
      "lowercased, already holds an overlapping reservation), then availability (409 " +
      "`NO_AVAILABILITY` with `details.reason`; in precedence order `too_soon`, " +
      "`too_far_ahead`, `closed_date`, `closed_day`, `outside_service_hours`, " +
      "`party_too_large`, `no_table_free`). `no_table_free` is also the answer to a request " +
      "that loses a race for the last table to another request. There is no idempotency key: " +
      "repeating a request that had succeeded is refused as a duplicate reservation, and a " +
      "retry after a 500 may be refused as a duplicate if a hold remains. No email is sent.",
    tags: TAGS,
    auth: false,
    request: { body: { schema: CreateReservationBodySchema, example: CREATE_RESERVATION_EXAMPLE } },
    success: {
      status: 201,
      description: "The confirmed reservation, including the secret code (shown only here).",
      schema: ReservationConfirmationSchema,
    },
    errors: ["VALIDATION_ERROR", "CONFLICT", "NO_AVAILABILITY"],
    handler: controller.create,
  });
}
