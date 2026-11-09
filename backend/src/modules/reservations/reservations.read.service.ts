import type { Types } from "mongoose";
import { Table } from "../tables/table.model.js";
import { Reservation } from "./reservation.model.js";
import {
  buildSummary,
  sortReservations,
  toReservationView,
  type ReservationRow,
} from "./reservation-view.domain.js";
import type { DayView } from "./reservations.schemas.js";

/**
 * Read-only side of the reservations module (feature 004). It imports only the two models, the
 * pure view functions and the shared helpers: no write helper, interval claim, notifier, email
 * sender or secret-code helper, so it cannot change anything or touch the secret code.
 */

export type ListStatus = "confirmed" | "all" | "cancelled";

// Whitelisted projection: the secret code hash is never requested (and is `select: false`).
const ROW_FIELDS = {
  status: 1,
  date: 1,
  startTime: 1,
  endTime: 1,
  startAt: 1,
  partySize: 1,
  guestName: 1,
  guestEmail: 1,
  guestPhone: 1,
  tableId: 1,
  createdAt: 1,
  cancelledAt: 1,
  cancelledBy: 1,
} as const;

const UNKNOWN_TABLE = "unknown";

/**
 * The reservations of one restaurant-local date. ONE read for all statuses and ONE read for the
 * table names (removed tables included), so the list and the summary come from one snapshot.
 *
 * Feature 004 US1: only the default `confirmed` behavior exists; the status argument is
 * deliberately ignored until US2 adds the `all` and `cancelled` branches.
 */
export async function listDay(date: string, _status: ListStatus): Promise<DayView> {
  const rows = await Reservation.find({ date }, ROW_FIELDS).lean<ReservationRow[]>();

  const tableIds = [...new Map(rows.map((r) => [r.tableId.toHexString(), r.tableId])).values()];
  const tables =
    tableIds.length === 0
      ? []
      : await Table.find({ _id: { $in: tableIds } }, { name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>();
  const names = new Map(tables.map((t) => [t._id.toHexString(), t.name]));

  const nameOf = (tableId: Types.ObjectId): string => names.get(tableId.toHexString()) ?? UNKNOWN_TABLE;

  const confirmed = rows.filter((r) => r.status === "confirmed");
  const reservations = sortReservations(confirmed, nameOf).map((row) => {
    const name = nameOf(row.tableId);
    if (name === UNKNOWN_TABLE && !names.has(row.tableId.toHexString())) {
      // Ids only: never a guest name, email or phone.
      console.error(JSON.stringify({ event: "table_missing", reservationId: row._id.toHexString() }));
    }
    return toReservationView(row, name);
  });

  return { date, status: "confirmed", summary: buildSummary(rows), reservations };
}
