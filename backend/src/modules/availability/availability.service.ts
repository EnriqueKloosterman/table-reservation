import { checkAvailability } from "./availability.domain.js";
import type { AvailabilityQuery, AvailabilityResponse } from "./availability.schemas.js";
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
