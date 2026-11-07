import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import { DAYS, type DayName, type ServicePeriod } from "../../src/modules/schedule/schedule.domain.js";
import { WEEKLY_SCHEDULE_ID, WeeklySchedule } from "../../src/modules/schedule/schedule.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { nameKey } from "../../src/shared/validation/normalize.js";

export type SeedRestaurantOptions = {
  tables?: { name: string; capacity: number; removed?: boolean }[];
  /** Periods per weekday; days not listed have no service. Left untouched when omitted. */
  schedule?: Partial<Record<DayName, ServicePeriod[]>>;
  /** `YYYY-MM-DD` dates, or `{ date, reason }`. */
  closedDates?: (string | { date: string; reason?: string })[];
};

export type SeededTable = { id: string; name: string; capacity: number };

/** Writes tables, the weekly schedule and closed dates through the models. */
export async function seedRestaurant({
  tables = [],
  schedule,
  closedDates = [],
}: SeedRestaurantOptions = {}): Promise<{ tables: SeededTable[] }> {
  const seeded: SeededTable[] = [];
  for (const t of tables) {
    const doc = await Table.create({
      name: t.name,
      nameKey: nameKey(t.name),
      capacity: t.capacity,
      removed: t.removed ?? false,
      removedAt: t.removed ? new Date(0) : null,
    });
    seeded.push({ id: doc._id.toHexString(), name: doc.name, capacity: doc.capacity });
  }
  // Only written when given, so a later call can add tables without wiping the schedule.
  if (schedule) {
    await WeeklySchedule.findByIdAndUpdate(
      WEEKLY_SCHEDULE_ID,
      { days: DAYS.map((day) => ({ day, periods: schedule[day] ?? [] })) },
      { upsert: true },
    );
  }
  for (const c of closedDates) {
    const entry = typeof c === "string" ? { date: c } : c;
    await ClosedDate.create({ date: entry.date, reason: "reason" in entry ? (entry.reason ?? null) : null });
  }
  return { tables: seeded };
}
