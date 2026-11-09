export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * True for an existing Gregorian date in the exact form `YYYY-MM-DD`. Pure arithmetic: no
 * `Date` parsing, which would silently roll `2026-02-30` over to March.
 */
export function isValidCalendarDate(s: string): boolean {
  if (!DATE_REGEX.test(s)) return false;
  const [year, month, day] = s.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12) return false;
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= daysInMonth;
}

/** The restaurant's calendar date at `now`, as `YYYY-MM-DD`, in the given IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
