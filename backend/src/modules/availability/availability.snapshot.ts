import type { Config } from "../../config/env.js";
import type { Clock } from "../../shared/clock.js";
import { dayOfWeek } from "../../shared/time/local-time.js";
import { ClosedDate } from "../closed-dates/closed-date.model.js";
import { TableDay } from "../reservations/calendar.model.js";
import { WEEKLY_SCHEDULE_ID, WeeklySchedule } from "../schedule/schedule.model.js";
import { Table } from "../tables/table.model.js";
import type { DaySnapshot, Interval, Rules } from "./availability.domain.js";

export type SnapshotDeps = { config: Config; clock: Clock };

/** The booking rules, from the validated configuration. */
export function rulesFrom(config: Config): Rules {
  return {
    timeZone: config.RESTAURANT_TIME_ZONE,
    durationMinutes: config.RESERVATION_DURATION_MINUTES,
    slotIntervalMinutes: config.TIME_SLOT_INTERVAL_MINUTES,
    minNoticeMinutes: config.MIN_NOTICE_MINUTES,
    horizonDays: config.BOOKING_HORIZON_DAYS,
  };
}

/**
 * A fresh read of everything the availability rules need for one date: the weekday's
 * periods, whether the date is closed, the non-removed tables and the intervals claimed on
 * that date (one read of at most one `TableDay` per table, by the unique-index prefix).
 */
export async function loadDaySnapshot(date: string, { config, clock }: SnapshotDeps): Promise<DaySnapshot> {
  const [schedule, closed, tableDocs] = await Promise.all([
    WeeklySchedule.findById(WEEKLY_SCHEDULE_ID).lean(),
    ClosedDate.exists({ date }),
    Table.find({ removed: false }, { name: 1, capacity: 1 }).lean(),
  ]);

  const day = dayOfWeek(date);
  const periods = (schedule?.days.find((d) => d.day === day)?.periods ?? [])
    .map(({ name, start, end }) => ({ name, start, end }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const tables = tableDocs.map((t) => ({ id: t._id.toHexString(), name: t.name, capacity: t.capacity }));

  const days = await TableDay.find({ tableId: { $in: tableDocs.map((t) => t._id) }, date }).lean();
  const intervalsByTable = new Map<string, Interval[]>();
  for (const d of days) {
    intervalsByTable.set(
      d.tableId.toHexString(),
      d.intervals.map(({ start, end }) => ({ start, end })),
    );
  }

  return {
    now: clock.now(),
    rules: rulesFrom(config),
    date,
    periods,
    isClosedDate: closed !== null,
    tables,
    intervalsByTable,
  };
}
