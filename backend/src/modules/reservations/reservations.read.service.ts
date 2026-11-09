import type { Types } from "mongoose";
import { notFound } from "../../shared/errors/app-error.js";
import { Table } from "../tables/table.model.js";
import { Reservation } from "./reservation.model.js";
import { RESERVATION_NOT_FOUND_MESSAGE } from "./reservation-id.js";
import {
  buildSummary,
  sortReservations,
  toReservationView,
  type ReservationItem,
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
 * `status` filters the LIST only; the summary always counts the confirmed reservations of the
 * whole snapshot, so it is identical under every choice.
 */
export async function listDay(date: string, status: ListStatus): Promise<DayView> {
  const rows = await Reservation.find({ date }, ROW_FIELDS).lean<ReservationRow[]>();

  const tableIds = [...new Map(rows.map((r) => [r.tableId.toHexString(), r.tableId])).values()];
  const tables =
    tableIds.length === 0
      ? []
      : await Table.find({ _id: { $in: tableIds } }, { name: 1 }).lean<{ _id: Types.ObjectId; name: string }[]>();
  const names = new Map(tables.map((t) => [t._id.toHexString(), t.name]));

  const nameOf = (tableId: Types.ObjectId): string => names.get(tableId.toHexString()) ?? UNKNOWN_TABLE;

  const shown = status === "all" ? rows : rows.filter((r) => r.status === status);
  const reservations = sortReservations(shown, nameOf).map((row) => {
    const name = nameOf(row.tableId);
    if (name === UNKNOWN_TABLE && !names.has(row.tableId.toHexString())) {
      // Ids only: never a guest name, email or phone.
      console.error(JSON.stringify({ event: "table_missing", reservationId: row._id.toHexString() }));
    }
    return toReservationView(row, name);
  });

  return { date, status, summary: buildSummary(rows), reservations };
}

/**
 * Feature 004 US4 skeleton (Constitution II, test-first): every id is "not found" and the database
 * is not touched. The real lookup arrives in US3 after its tests have been seen failing.
 */
export function readReservation(_id: string): Promise<ReservationItem> {
  return Promise.reject(notFound(RESERVATION_NOT_FOUND_MESSAGE));
}
