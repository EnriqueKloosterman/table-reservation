import type { Types } from "mongoose";
import { dayOfWeek } from "../../shared/time/local-time.js";
import type { DaySchedule, ServicePeriod } from "../schedule/schedule.domain.js";
import { Table } from "../tables/table.model.js";
import { isInsideSchedule } from "./affected.domain.js";
import { Reservation } from "./reservation.model.js";
import type { AffectedReservation } from "./affected.schemas.js";

/**
 * Reports for staff changes that may contradict upcoming reservations (FR-022, research R11).
 * Each query is computed after the change was written, lists only reservations that have not
 * ended (`endAt > now`), never modifies anything, and is complete and ordered by start
 * instant, then by id.
 */

type StoredReservation = {
  _id: Types.ObjectId;
  tableId: Types.ObjectId;
  date: string;
  startTime: string;
  endTime: string;
  startAt: Date;
  partySize: number;
  guestName: string;
};

async function toReport(docs: StoredReservation[]): Promise<AffectedReservation[]> {
  if (docs.length === 0) return [];
  const sorted = [...docs].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || a._id.toHexString().localeCompare(b._id.toHexString()),
  );
  // Removed tables are included: a reservation keeps referring to its table (FR-018).
  const tables = await Table.find({ _id: { $in: [...new Set(sorted.map((d) => d.tableId.toHexString()))] } }, { name: 1 }).lean();
  const names = new Map(tables.map((t) => [t._id.toHexString(), t.name]));
  return sorted.map((d) => ({
    id: d._id.toHexString(),
    date: d.date,
    startTime: d.startTime,
    endTime: d.endTime,
    partySize: d.partySize,
    guestName: d.guestName,
    tableName: names.get(d.tableId.toHexString()) ?? "",
  }));
}

/** Upcoming reservations on a newly closed date. */
export async function affectedByClosedDate(date: string, now: Date): Promise<AffectedReservation[]> {
  return toReport(await Reservation.find({ date, endAt: { $gt: now } }).lean());
}

/** Upcoming reservations no longer fully inside a service period of their weekday. */
export async function affectedBySchedule(days: DaySchedule[], now: Date): Promise<AffectedReservation[]> {
  const periodsByDay = new Map<string, ServicePeriod[]>(days.map((d) => [d.day, d.periods]));
  const upcoming = await Reservation.find({ endAt: { $gt: now } }).lean();
  return toReport(
    upcoming.filter((r) => !isInsideSchedule(r, periodsByDay.get(dayOfWeek(r.date)) ?? [])),
  );
}

/** Upcoming reservations on a table whose party no longer fits its new capacity. */
export async function affectedByCapacity(
  tableId: Types.ObjectId,
  newCapacity: number,
  now: Date,
): Promise<AffectedReservation[]> {
  return toReport(
    await Reservation.find({ tableId, endAt: { $gt: now }, partySize: { $gt: newCapacity } }).lean(),
  );
}
