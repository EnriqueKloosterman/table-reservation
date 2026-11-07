import { z } from "../../shared/openapi/zod.js";
import { DAYS } from "./schedule.domain.js";

export const DayNameSchema = z.enum(DAYS).openapi("DayName");

export const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be a time in HH:mm format (00:00-23:59)")
  .openapi("Time", {
    description: "Restaurant-local wall-clock time, HH:mm (00:00–23:59).",
    example: "12:00",
  });

export const ServicePeriodSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(50).openapi({ example: "Lunch" }),
    start: TimeSchema,
    end: TimeSchema,
  })
  .openapi("ServicePeriod", { description: "end must be after start; no midnight crossing." });

export const DayScheduleSchema = z
  .strictObject({ day: DayNameSchema, periods: z.array(ServicePeriodSchema) })
  .openapi("DaySchedule", { description: "An empty `periods` array means the day is closed." });

export const WeeklyScheduleSchema = z
  .strictObject({ days: z.array(DayScheduleSchema) })
  .openapi("WeeklySchedule");

export const WEEKLY_SCHEDULE_EXAMPLE = {
  days: [
    { day: "monday", periods: [] },
    {
      day: "tuesday",
      periods: [
        { name: "Lunch", start: "12:00", end: "15:00" },
        { name: "Dinner", start: "20:00", end: "23:30" },
      ],
    },
  ],
};
