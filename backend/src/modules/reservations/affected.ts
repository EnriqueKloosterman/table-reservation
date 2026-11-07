import type { Types } from "mongoose";
import type { DaySchedule } from "../schedule/schedule.domain.js";
import { Table } from "../tables/table.model.js";
import type { AffectedReservation } from "./affected.schemas.js";
import { Reservation } from "./reservation.model.js";

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
  // The rule is `isInsideSchedule` (some period of the reservation's weekday has
  // start <= startTime and endTime <= end). It is evaluated inside MongoDB so that, with
  // thousands of upcoming reservations, only the affected ones travel to the application
  // (SC-006). HH:mm strings are zero-padded, so comparing them as text equals comparing
  // minutes; the equivalence is checked by affected-schedule.equivalence.test.ts.
  const periodsOfWeekday = {
    $switch: {
      branches: days.map((d, index) => ({
        case: { $eq: ["$$weekday", index + 1] }, // $isoDayOfWeek: 1 = Monday … 7 = Sunday
        then: d.periods.map(({ start, end }) => ({ start, end })),
      })),
      default: [],
    },
  };
  const isInside = {
    $anyElementTrue: {
      $map: {
        input: periodsOfWeekday,
        as: "period",
        in: {
          $and: [
            { $lte: ["$$period.start", "$startTime"] },
            { $lte: ["$endTime", "$$period.end"] },
          ],
        },
      },
    },
  };
  const affected = await Reservation.aggregate<{ _id: Types.ObjectId }>([
    { $match: { endAt: { $gt: now } } },
    {
      $match: {
        $expr: {
          $let: {
            vars: { weekday: { $isoDayOfWeek: { $dateFromString: { dateString: "$date" } } } },
            in: { $not: [isInside] },
          },
        },
      },
    },
    { $project: { _id: 1 } },
  ]);
  if (affected.length === 0) return [];
  return toReport(await Reservation.find({ _id: { $in: affected.map((r) => r._id) } }).lean());
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
