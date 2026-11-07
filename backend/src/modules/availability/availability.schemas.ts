import { AvailabilityReasonSchema } from "../../shared/openapi/common.js";
import { z } from "../../shared/openapi/zod.js";
import { CalendarDateSchema } from "../closed-dates/closed-dates.schemas.js";
import { TimeSchema } from "../schedule/schedule.schemas.js";

const PARTY_SIZE_MESSAGE = "Must be a whole number from 1 to 50 without sign, decimals or leading zeros";

/**
 * `partySize` travels in the query string, so it is a decimal string (`1`-`50`, no leading
 * zeros) turned into a number. A repeated parameter arrives as an array and fails.
 */
const PartySizeQuery = z
  .string()
  .regex(/^[1-9][0-9]?$/, PARTY_SIZE_MESSAGE)
  .transform(Number)
  .pipe(z.number().max(50, PARTY_SIZE_MESSAGE))
  .openapi({
    description: "Number of guests: a whole number from 1 to 50, without sign or leading zeros.",
    example: "4",
  });

const dateParam = CalendarDateSchema.openapi({
  description: "Restaurant-local calendar date, exactly YYYY-MM-DD.",
  example: "2026-11-14",
});

const timeParam = TimeSchema.openapi({
  description: "Restaurant-local start time, HH:mm (00:00-23:59).",
  example: "20:30",
});

export const AvailabilityQuerySchema = z.strictObject({
  date: dateParam,
  time: timeParam,
  partySize: PartySizeQuery,
});

export const AvailabilityResponseSchema = z
  .object({
    date: z.string().openapi({ example: "2026-11-14" }),
    time: z.string().openapi({ example: "20:30" }),
    partySize: z.number().int().openapi({ example: 4 }),
    available: z.boolean(),
    reason: AvailabilityReasonSchema.optional().openapi({
      description: "Present if and only if `available` is false.",
    }),
  })
  .openapi("AvailabilityResponse", {
    example: { date: "2026-11-14", time: "21:45", partySize: 4, available: false, reason: "outside_service_hours" },
  });

export type AvailabilityQuery = z.output<typeof AvailabilityQuerySchema>;
export type AvailabilityResponse = z.output<typeof AvailabilityResponseSchema>;
