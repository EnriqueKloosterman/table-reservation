import { DAYS, type DayName } from "../../modules/schedule/schedule.domain.js";

/**
 * Local wall-clock <-> UTC conversion with `Intl` only (research R2). A calendar date is
 * `"YYYY-MM-DD"` and a time `"HH:mm"`, both interpreted in an IANA time zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The restaurant-local date and time of an instant. */
export function utcToLocal(instant: Date, timeZone: string): { date: string; time: string } {
  const p = localParts(instant, timeZone);
  return { date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Offset of the zone from UTC at an instant, in milliseconds (local minus UTC). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant of a local wall-clock value: `null` when it does not exist (DST gap), the
 * earliest instant when it occurs twice (DST fold).
 */
export function localToUtc(date: string, time: string, timeZone: string): Date | null {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  // The offsets before and after any transition on that day.
  const offsets = new Set([
    offsetMs(new Date(guess - DAY_MS), timeZone),
    offsetMs(new Date(guess + DAY_MS), timeZone),
  ]);

  const matches = [...offsets]
    .map((offset) => new Date(guess - offset))
    .filter((candidate) => {
      const local = utcToLocal(candidate, timeZone);
      return local.date === date && local.time === time;
    })
    .sort((a, b) => a.getTime() - b.getTime());

  return matches[0] ?? null;
}

/** Calendar arithmetic on `YYYY-MM-DD`; no time zone involved. */
export function addDays(date: string, n: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}

/** The weekday of a calendar date. */
export function dayOfWeek(date: string): DayName {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return DAYS[(sundayFirst + 6) % 7]!;
}

/** Half-open overlap: `a.start < b.end && b.start < a.end`. */
export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}
