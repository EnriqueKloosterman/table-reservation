import { todayInTimeZone } from "../closed-dates/closed-dates.domain.js";
import { toMinutes, type ServicePeriod } from "../schedule/schedule.domain.js";
import { addDays, localToUtc, overlaps } from "../../shared/time/local-time.js";
import type { AvailabilityReason } from "../../shared/errors/app-error.js";

/**
 * Pure availability rules (research R3, R7, R9). No I/O and no clock access: "now" is part of
 * the snapshot, which the service builds from the injected `Clock`.
 */

export type Reason = AvailabilityReason;

export type Rules = {
  timeZone: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
};

/** A non-removed table. */
export type TableInfo = { id: string; name: string; capacity: number };

export type Interval = { start: Date; end: Date };

export type DaySnapshot = {
  now: Date;
  rules: Rules;
  /** Restaurant-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** The weekday's service periods, sorted by start. */
  periods: ServicePeriod[];
  isClosedDate: boolean;
  tables: TableInfo[];
  /** Claimed intervals of that date, by table id. */
  intervalsByTable: Map<string, Interval[]>;
};

export type AvailabilityResult =
  | { available: true; tables: TableInfo[] }
  | { available: false; reason: Reason };

export type BookableTimes = { periods: { name: string; times: string[] }[]; reason?: Reason };

const MINUTE_MS = 60_000;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Tables that seat the party and have no interval overlapping `range`, ordered by capacity
 * ascending, then by name in natural, case-insensitive order ("T2" before "T10").
 */
export function chooseTables(
  tables: TableInfo[],
  partySize: number,
  intervalsByTable: Map<string, Interval[]>,
  range: Interval,
): TableInfo[] {
  return tables
    .filter(
      (t) =>
        t.capacity >= partySize &&
        !(intervalsByTable.get(t.id) ?? []).some((interval) => overlaps(interval, range)),
    )
    .sort((a, b) => a.capacity - b.capacity || collator.compare(a.name, b.name));
}

/** Does a reservation starting at `time` fit entirely inside one period (wall-clock minutes, R3)? */
export function fitsInsideAPeriod(
  periods: ServicePeriod[],
  time: string,
  durationMinutes: number,
): boolean {
  const minutes = toMinutes(time);
  return periods.some(
    (p) => toMinutes(p.start) <= minutes && minutes + durationMinutes <= toMinutes(p.end),
  );
}

/** Date-level reasons shared by both lookups: `date < today` and beyond the horizon. */
function dateWindowReason(snapshot: DaySnapshot): Reason | null {
  const today = todayInTimeZone(snapshot.rules.timeZone, snapshot.now);
  if (snapshot.date < today) return "too_soon";
  if (snapshot.date > addDays(today, snapshot.rules.horizonDays)) return "too_far_ahead";
  return null;
}

/** Can a party of `partySize` start at `time` on the snapshot's date? */
export function checkAvailability(
  snapshot: DaySnapshot,
  { time, partySize }: { time: string; partySize: number },
): AvailabilityResult {
  const { now, rules, date, periods, tables, intervalsByTable } = snapshot;
  const startAt = localToUtc(date, time, rules.timeZone);

  // 1. too_soon: a past date, or a start inside the minimum notice.
  const today = todayInTimeZone(rules.timeZone, now);
  if (date < today) return { available: false, reason: "too_soon" };
  if (startAt && startAt.getTime() < now.getTime() + rules.minNoticeMinutes * MINUTE_MS) {
    return { available: false, reason: "too_soon" };
  }

  // 2. too_far_ahead (inclusive horizon).
  if (date > addDays(today, rules.horizonDays)) return { available: false, reason: "too_far_ahead" };

  // 3-4. closed date, closed weekday.
  if (snapshot.isClosedDate) return { available: false, reason: "closed_date" };
  if (periods.length === 0) return { available: false, reason: "closed_day" };

  // 5. the whole reservation must fit inside one period, on wall-clock minutes (R3).
  if (startAt === null || !fitsInsideAPeriod(periods, time, rules.durationMinutes)) return { available: false, reason: "outside_service_hours" };

  // 6-7. tables.
  if (!tables.some((t) => t.capacity >= partySize)) {
    return { available: false, reason: "party_too_large" };
  }
  const endAt = new Date(startAt.getTime() + rules.durationMinutes * MINUTE_MS);
  const candidates = chooseTables(tables, partySize, intervalsByTable, { start: startAt, end: endAt });
  if (candidates.length === 0) return { available: false, reason: "no_table_free" };
  return { available: true, tables: candidates };
}

/**
 * Bookable start times grouped by period. A grid time is listed exactly when
 * `checkAvailability` accepts it, which makes the list and the check agree by construction
 * (SC-004). An empty list carries exactly one reason, in FR-008 order.
 */
export function listBookableTimes(
  snapshot: DaySnapshot,
  { partySize }: { partySize: number },
): BookableTimes {
  const { rules, periods } = snapshot;
  const outcomes: { available: boolean; reason?: Reason }[] = [];
  const grouped: { name: string; times: string[] }[] = [];

  for (const period of periods) {
    const times: string[] = [];
    const end = toMinutes(period.end);
    for (let m = toMinutes(period.start); m + rules.durationMinutes <= end; m += rules.slotIntervalMinutes) {
      const time = formatTime(m);
      const result = checkAvailability(snapshot, { time, partySize });
      outcomes.push(result);
      if (result.available) times.push(time);
    }
    if (times.length > 0) grouped.push({ name: period.name, times });
  }

  if (grouped.length > 0) return { periods: grouped };

  const dateReason = dateWindowReason(snapshot);
  if (dateReason) return { periods: [], reason: dateReason };
  if (snapshot.isClosedDate) return { periods: [], reason: "closed_date" };
  if (periods.length === 0) return { periods: [], reason: "closed_day" };
  if (!snapshot.tables.some((t) => t.capacity >= partySize)) {
    return { periods: [], reason: "party_too_large" };
  }
  // No grid time at all (no period long enough) or every one is a nonexistent DST time.
  const remaining = outcomes.filter((o) => o.reason !== "outside_service_hours");
  if (remaining.length === 0) return { periods: [], reason: "outside_service_hours" };
  if (remaining.every((o) => o.reason === "too_soon")) return { periods: [], reason: "too_soon" };
  return { periods: [], reason: "no_table_free" };
}
