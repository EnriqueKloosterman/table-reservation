import { checkAvailability, listBookableTimes } from "./availability.domain.js";
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  TimesQuery,
  TimesResponse,
} from "./availability.schemas.js";
import { loadDaySnapshot, type SnapshotDeps } from "./availability.snapshot.js";

/** Yes/no with a reason. The candidate tables are internal and never returned. */
export async function checkAvailabilityFor(
  { date, time, partySize }: AvailabilityQuery,
  deps: SnapshotDeps,
): Promise<AvailabilityResponse> {
  const snapshot = await loadDaySnapshot(date, deps);
  const result = checkAvailability(snapshot, { time, partySize });
  return result.available
    ? { date, time, partySize, available: true }
    : { date, time, partySize, available: false, reason: result.reason };
}

/** Bookable start times of a date for a party, grouped by service period (FR-008). */
export async function listTimesFor(
  { date, partySize }: TimesQuery,
  deps: SnapshotDeps,
): Promise<TimesResponse> {
  const snapshot = await loadDaySnapshot(date, deps);
  const { periods, reason } = listBookableTimes(snapshot, { partySize });
  return reason ? { date, partySize, periods, reason } : { date, partySize, periods };
}
