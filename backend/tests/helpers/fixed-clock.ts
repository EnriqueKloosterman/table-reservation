import { fixedClock as clockAt, type Clock } from "../../src/shared/clock.js";

/** A `Clock` pinned to an ISO instant, e.g. `fixedClock("2026-11-09T10:00:00Z")`. */
export function fixedClock(iso: string): Clock {
  return clockAt(new Date(iso));
}
