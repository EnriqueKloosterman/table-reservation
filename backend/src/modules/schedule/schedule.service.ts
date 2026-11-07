import type { Clock } from "../../shared/clock.js";
import { validationError } from "../../shared/errors/app-error.js";
import { affectedBySchedule } from "../reservations/affected.js";
import type { AffectedReservation } from "../reservations/affected.schemas.js";
import {
  DAYS,
  validateWeeklySchedule,
  type NormalizedSchedule,
  type WeeklyScheduleInput,
} from "./schedule.domain.js";
import { WEEKLY_SCHEDULE_ID, WeeklySchedule } from "./schedule.model.js";

export type ReplacedSchedule = NormalizedSchedule & { affectedReservations: AffectedReservation[] };

type StoredDays = { day: string; periods: { name: string; start: string; end: string }[] }[];

function toSchedule(stored: StoredDays | undefined): NormalizedSchedule {
  const byDay = new Map((stored ?? []).map((d) => [d.day, d.periods]));
  return {
    days: DAYS.map((day) => ({
      day,
      periods: (byDay.get(day) ?? []).map(({ name, start, end }) => ({ name, start, end })),
    })),
  };
}

/** The stored schedule, or 7 closed days when none was ever set (nothing is written). */
export async function getSchedule(): Promise<NormalizedSchedule> {
  const doc = await WeeklySchedule.findById(WEEKLY_SCHEDULE_ID).lean();
  return toSchedule(doc?.days);
}

/**
 * Replaces the whole schedule. Cross-item rules run before any write, so a refused update
 * leaves storage untouched; the write itself is one atomic upsert.
 */
export async function replaceSchedule(
  input: WeeklyScheduleInput,
  { clock }: { clock: Clock },
): Promise<ReplacedSchedule> {
  const result = validateWeeklySchedule(input);
  if (!result.ok) throw validationError(result.errors);

  const doc = await WeeklySchedule.findOneAndUpdate(
    { _id: WEEKLY_SCHEDULE_ID },
    { $set: { days: result.value.days } },
    { upsert: true, returnDocument: "after", runValidators: true },
  ).lean();
  const schedule = toSchedule(doc?.days);
  // Informational (FR-022), computed after the write: stored reservations are never changed.
  return { ...schedule, affectedReservations: await affectedBySchedule(schedule.days, clock.now()) };
}
