import type { FieldError } from "../../shared/errors/app-error.js";

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DayName = (typeof DAYS)[number];

export type ServicePeriod = { name: string; start: string; end: string };
export type DaySchedule = { day: DayName; periods: ServicePeriod[] };
export type WeeklyScheduleInput = { days: DaySchedule[] };
/** Always 7 days, Monday first, periods sorted by start, names trimmed. */
export type NormalizedSchedule = { days: DaySchedule[] };

export type ScheduleValidation =
  | { ok: true; value: NormalizedSchedule }
  | { ok: false; errors: FieldError[] };

/** `"HH:mm"` → minutes since midnight. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

function sortByStart(periods: ServicePeriod[]): ServicePeriod[] {
  return [...periods].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function validateDay(
  { day, periods }: DaySchedule,
  dayIndex: number,
  errors: FieldError[],
): void {
  const at = (j: number, prop: keyof ServicePeriod) => `days[${dayIndex}].periods[${j}].${prop}`;
  const items = periods.map((period, index) => ({
    index,
    name: period.name.trim(),
    start: toMinutes(period.start),
    end: toMinutes(period.end),
    period,
  }));
  const dayErrors: { index: number; error: FieldError }[] = [];

  // end must be after start (no midnight crossing)
  for (const item of items) {
    if (item.end <= item.start) {
      dayErrors.push({
        index: item.index,
        error: { field: at(item.index, "end"), reason: `${day} '${item.name}': end must be after start` },
      });
    }
  }

  // overlaps, among periods with a valid range; equal boundaries are allowed
  const ordered = items
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.index - b.index);
  let latest = ordered[0];
  for (const item of ordered.slice(1)) {
    if (latest && item.start < latest.end) {
      dayErrors.push({
        index: item.index,
        error: {
          field: at(item.index, "start"),
          reason:
            `${day} '${item.name}' overlaps '${latest.name}' ` +
            `(${latest.period.start}-${latest.period.end})`,
        },
      });
    }
    if (!latest || item.end > latest.end) latest = item;
  }

  // duplicate names, case-insensitive, reported on the later occurrence
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      dayErrors.push({
        index: item.index,
        error: { field: at(item.index, "name"), reason: `${day}: duplicate period name '${key}'` },
      });
    }
    seen.add(key);
  }

  dayErrors.sort((a, b) => a.index - b.index);
  errors.push(...dayErrors.map((e) => e.error));
}

/**
 * Cross-item rules of a weekly schedule (stage 2, after the Zod shape check): each day at
 * most once, end after start, no overlaps, no duplicate names within a day. Error fields use
 * the indexes of the request as submitted.
 */
export function validateWeeklySchedule(input: WeeklyScheduleInput): ScheduleValidation {
  const errors: FieldError[] = [];
  const seenDays = new Set<DayName>();

  input.days.forEach((daySchedule, i) => {
    if (seenDays.has(daySchedule.day)) {
      errors.push({ field: `days[${i}].day`, reason: `${daySchedule.day}: day appears more than once` });
    }
    seenDays.add(daySchedule.day);
    validateDay(daySchedule, i, errors);
  });

  if (errors.length > 0) return { ok: false, errors };

  const byDay = new Map(input.days.map((d) => [d.day, d.periods]));
  return {
    ok: true,
    value: {
      days: DAYS.map((day) => ({
        day,
        periods: sortByStart(byDay.get(day) ?? []).map(({ name, start, end }) => ({
          name: name.trim(),
          start,
          end,
        })),
      })),
    },
  };
}
