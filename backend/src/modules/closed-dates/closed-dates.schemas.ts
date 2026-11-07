import { z } from "../../shared/openapi/zod.js";
import { DATE_REGEX, isValidCalendarDate } from "./closed-dates.domain.js";

export const CalendarDateSchema = z
  .string()
  .refine(isValidCalendarDate, "Must be a real calendar date in YYYY-MM-DD format")
  .openapi("CalendarDate", {
    description: "Restaurant-local calendar date, exactly YYYY-MM-DD.",
    format: "date",
    pattern: DATE_REGEX.source,
    example: "2026-12-25",
  });

export const CreateClosedDateSchema = z
  .strictObject({
    date: CalendarDateSchema,
    reason: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((r) => (r ? r : null))
      .openapi({
        description: "Optional, ≤ 200 characters after trimming; empty or absent → null.",
        example: "Christmas",
      }),
  })
  .openapi("CreateClosedDate");
export const CREATE_CLOSED_DATE_EXAMPLE = { date: "2026-12-25", reason: "Christmas" };

/** A repeated parameter arrives as an array and fails the enum. */
export const ListClosedDatesQuerySchema = z.strictObject({
  includePast: z
    .enum(["true", "false"])
    .default("false")
    .openapi({ description: 'Exactly "true" or "false" (default). "true" also lists past closures.' }),
});

export const ClosedDateParamsSchema = z.strictObject({ date: CalendarDateSchema });

export const ClosedDateSchema = z
  .object({
    date: z.string().openapi({ example: "2026-12-25" }),
    reason: z.string().nullable().openapi({ example: "Christmas" }),
  })
  .openapi("ClosedDate");

export type CreateClosedDateInput = z.output<typeof CreateClosedDateSchema>;
export type ListClosedDatesQuery = z.output<typeof ListClosedDatesQuerySchema>;
export type ClosedDateDto = z.output<typeof ClosedDateSchema>;
