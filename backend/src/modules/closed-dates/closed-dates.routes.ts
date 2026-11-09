import { defineRoute, type RouteContext } from "../../shared/openapi/route.js";
import { z } from "../../shared/openapi/zod.js";
import { createClosedDatesController } from "./closed-dates.controller.js";
import {
  CREATE_CLOSED_DATE_EXAMPLE,
  ClosedDateParamsSchema,
  ClosedDateSchema,
  CreatedClosedDateSchema,
  CreateClosedDateSchema,
  ListClosedDatesQuerySchema,
} from "./closed-dates.schemas.js";

const TAGS = ["Closed dates"];
const DATE_NOTE =
  "Dates are restaurant-local calendar dates (YYYY-MM-DD); \"today\" is decided by the " +
  "server in the restaurant's time zone.";

export function registerClosedDateRoutes(ctx: RouteContext): void {
  const controller = createClosedDatesController(ctx);

  defineRoute(ctx, {
    method: "post",
    path: "/closed-dates",
    summary: "Close a date",
    description:
      "Marks a calendar date as closed, with an optional reason. The date must exist in the " +
      "calendar and be today or later (a past date is 400, even if it is already closed). A " +
      "date that is already closed is 409 CONFLICT. The date is closed even when upcoming " +
      "reservations (not yet ended) exist on it: they are listed in `affectedReservations` " +
      "(always present, complete, ordered by start instant then id) and are never changed. " +
      DATE_NOTE,
    tags: TAGS,
    auth: true,
    request: { body: { schema: CreateClosedDateSchema, example: CREATE_CLOSED_DATE_EXAMPLE } },
    success: {
      status: 201,
      description: "The closed date and the upcoming reservations on it.",
      schema: CreatedClosedDateSchema,
    },
    errors: ["VALIDATION_ERROR", "CONFLICT"],
    handler: controller.create,
  });

  defineRoute(ctx, {
    method: "get",
    path: "/closed-dates",
    summary: "List closed dates",
    description:
      "Lists closed dates in ascending order, from today onwards unless `includePast=true`. " +
      `\`includePast\` accepts exactly "true" or "false". ${DATE_NOTE}`,
    tags: TAGS,
    auth: true,
    request: { query: ListClosedDatesQuerySchema },
    success: { status: 200, description: "Closed dates.", schema: z.array(ClosedDateSchema) },
    errors: ["VALIDATION_ERROR"],
    handler: controller.list,
  });

  defineRoute(ctx, {
    method: "delete",
    path: "/closed-dates/:date",
    summary: "Reopen a date",
    description:
      "Removes the closure of a date, including past ones. A malformed or impossible date is " +
      `400 (field \`params.date\`); a valid date that is not closed is 404. ${DATE_NOTE}`,
    tags: TAGS,
    auth: true,
    request: { params: ClosedDateParamsSchema },
    success: { status: 204, description: "Removed. No body." },
    errors: ["VALIDATION_ERROR", "NOT_FOUND"],
    handler: controller.remove,
  });
}
