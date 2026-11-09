import { toMinutes, type ServicePeriod } from "../schedule/schedule.domain.js";

/**
 * Is a stored reservation still fully inside one service period? Compares the stored
 * wall-clock `startTime`/`endTime` (research R3, R11): some period with
 * `start <= startTime` and `endTime <= end`.
 */
export function isInsideSchedule(
  { startTime, endTime }: { startTime: string; endTime: string },
  periods: ServicePeriod[],
): boolean {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  return periods.some((p) => toMinutes(p.start) <= start && end <= toMinutes(p.end));
}
