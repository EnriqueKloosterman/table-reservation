const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export const DATE_NOT_AVAILABLE = "Date not available";
export const TIME_NOT_AVAILABLE = "Time not available";

/** True for a real calendar day written as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** "2026-11-14" -> "Saturday 14 November 2026", independent of the visitor's time zone. */
export function formatDate(value: string): string {
  const match = DATE_RE.exec(value);
  if (!match || !isCalendarDate(value)) return DATE_NOT_AVAILABLE;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return FORMAT.format(date).replace(/^(\w+),\s*/, "$1 ");
}

/** Times are restaurant-local HH:mm and shown exactly as returned. */
export function formatTime(value: string): string {
  return TIME_RE.test(value) ? value : TIME_NOT_AVAILABLE;
}
