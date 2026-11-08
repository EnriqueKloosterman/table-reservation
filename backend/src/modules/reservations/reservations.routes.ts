import type { Notifier } from "../notifications/notifier.js";
import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { createReservationsController } from "./reservations.controller.js";
import type { ReservationTestHooks } from "./reservations.ops.js";
import {
  CANCEL_RESERVATION_EXAMPLE,
  CancelBodySchema,
  CancellationResultSchema,
  CREATE_RESERVATION_EXAMPLE,
  CreateReservationBodySchema,
  ReservationConfirmationSchema,
  ReservationIdParamsSchema,
  ReservationStatusSchema,
} from "./reservations.schemas.js";

const TAGS = ["Reservations"];

export function registerReservationRoutes(
  ctx: RouteContext,
  notifier: Notifier,
  testHooks?: ReservationTestHooks,
): void {
  const controller = createReservationsController(ctx, notifier, testHooks);
  // Published as a component so clients can see every value a reservation status can take.
  ctx.registry.register("ReservationStatus", ReservationStatusSchema);

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
      "retry after a 500 may be refused as a duplicate if a hold remains. After a successful " +
      "creation a confirmation email with the details and the cancellation link is sent to the " +
      "guest in the background; a failure to send it never changes this response. The new " +
      "reservation has status `confirmed` (see `ReservationStatus`).",
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

  // Declared before any `/reservations/:id...` route so `cancel` is never read as an id.
  defineRoute(ctx, {
    method: "post",
    path: "/reservations/cancel",
    summary: "Cancel a reservation with its secret code",
    description:
      "Public — no sign-in required. Cancels an upcoming confirmed reservation identified by " +
      "the secret code from its confirmation email. The code is accepted only in the request " +
      "body, never in the URL, so it does not end up in logs or browser history. On success " +
      "the table and the guest's time slot are released at once and the guest receives a " +
      "cancellation email (a failure to send it never changes the answer). Refusal order: " +
      "validation (400), unknown code (404 `NOT_FOUND`, one generic answer for every code that " +
      "matches nothing), then 409: `ALREADY_CANCELLED` (safe to repeat, changes nothing) takes " +
      "precedence over `CANNOT_CANCEL` (the start time has been reached or passed). If the " +
      "release cannot be completed the answer is 500 and a repeated request with the same code " +
      "repairs it. The response is never cached.",
    tags: TAGS,
    auth: false,
    request: { body: { schema: CancelBodySchema, example: CANCEL_RESERVATION_EXAMPLE } },
    success: {
      status: 200,
      description: "The reservation is now cancelled.",
      schema: CancellationResultSchema,
    },
    errors: ["VALIDATION_ERROR", "NOT_FOUND", "ALREADY_CANCELLED", "CANNOT_CANCEL"],
    handler: controller.cancelByCode,
  });

  defineRoute(ctx, {
    method: "post",
    path: "/reservations/:id/cancel",
    summary: "Cancel a reservation as staff",
    description:
      "Staff sign-in is required (bearer token). Cancels an upcoming confirmed reservation by " +
      "its id, with the same rules as the guest cancellation: the table and the guest's time " +
      "slot are released at once and the guest receives a cancellation email (a failure to " +
      "send it never changes the answer). Use it for the reservations listed in " +
      "`affectedReservations` after a closed date, schedule or table change. Check order: " +
      "authentication (401), then an unknown or malformed id (404 `NOT_FOUND`, the same " +
      "answer as the guest operation), then 409: `ALREADY_CANCELLED` (safe to repeat, changes " +
      "nothing) takes precedence over `CANNOT_CANCEL` (the start time has been reached or " +
      "passed). No request body is needed; one that is sent is ignored. If the release cannot " +
      "be completed the answer is 500 and a repeated request repairs it. The response is " +
      "never cached.",
    tags: TAGS,
    auth: true,
    request: { params: ReservationIdParamsSchema },
    success: {
      status: 200,
      description: "The reservation is now cancelled.",
      schema: CancellationResultSchema,
    },
    errors: ["NOT_FOUND", "ALREADY_CANCELLED", "CANNOT_CANCEL"],
    handler: controller.cancelByStaff,
  });
}
