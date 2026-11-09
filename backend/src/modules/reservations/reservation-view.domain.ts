import type { Types } from "mongoose";

/**
 * Pure view functions of the staff day view (feature 004). No I/O, no clock: everything works
 * over one in-memory snapshot of the day's rows, so a list and its summary cannot disagree.
 */

/** The stored fields the view reads. `secretCodeHash` is deliberately not part of this type. */
export type ReservationRow = {
  _id: Types.ObjectId;
  status: "confirmed" | "cancelled";
  date: string;
  startTime: string;
  endTime: string;
  startAt: Date;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  tableId: Types.ObjectId;
  createdAt: Date;
  cancelledAt?: Date | null | undefined;
  cancelledBy?: "guest" | "staff" | null | undefined;
};

export type ReservationItem = {
  id: string;
  status: "confirmed" | "cancelled";
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
  guest: { name: string; email: string; phone: string };
  table: { name: string };
  createdAt: string;
  cancelledAt?: string;
  cancelledBy?: "guest" | "staff";
};

export type DaySummary = { reservations: number; guests: number; tablesUsed: number };

// Natural order, case-insensitive: T2 before T10 (same rule as the table assignment of feature 002).
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Total order: start instant ascending, then table name in natural order, then id hex. Returns a
 * new array; the input is not touched.
 */
export function sortReservations(
  rows: readonly ReservationRow[],
  nameOf: (tableId: Types.ObjectId) => string,
): ReservationRow[] {
  return [...rows].sort((a, b) => {
    const byStart = a.startAt.getTime() - b.startAt.getTime();
    if (byStart !== 0) return byStart;
    const byName = collator.compare(nameOf(a.tableId), nameOf(b.tableId));
    if (byName !== 0) return byName;
    const aId = a._id.toHexString();
    const bId = b._id.toHexString();
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

/** Confirmed reservations only; tables are counted by id, never by name (a removed table's name can be reused). */
export function buildSummary(rows: readonly ReservationRow[]): DaySummary {
  let reservations = 0;
  let guests = 0;
  const tables = new Set<string>();
  for (const row of rows) {
    if (row.status !== "confirmed") continue;
    reservations += 1;
    guests += row.partySize;
    tables.add(row.tableId.toHexString());
  }
  return { reservations, guests, tablesUsed: tables.size };
}

/**
 * Builds one response item field by field from a whitelist. The row is never spread, so nothing
 * the row carries beyond these fields (hash, code, `startAt`, `tableId`, `__v`) can reach a response.
 */
export function toReservationView(row: ReservationRow, tableName: string): ReservationItem {
  const view: ReservationItem = {
    id: row._id.toHexString(),
    status: row.status,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    partySize: row.partySize,
    guest: { name: row.guestName, email: row.guestEmail, phone: row.guestPhone },
    table: { name: tableName },
    createdAt: row.createdAt.toISOString(),
  };
  if (row.status === "cancelled") {
    // A cancelled document missing these (should not happen) is shown without them, not failed.
    if (row.cancelledAt) view.cancelledAt = row.cancelledAt.toISOString();
    if (row.cancelledBy) view.cancelledBy = row.cancelledBy;
  }
  return view;
}
