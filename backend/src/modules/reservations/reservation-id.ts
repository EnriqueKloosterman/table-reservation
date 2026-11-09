import { Types } from "mongoose";

/** The one message for every id that matches no reservation, malformed or unknown (FR-008). */
export const RESERVATION_NOT_FOUND_MESSAGE = "Reservation not found";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Strict parse shared by the read, report and staff-cancel operations: exactly 24 hex characters
 * or `null`. A malformed id must become a 404 before the database is touched, because `findById`
 * with a non-hex string throws a cast error (a 500).
 */
export function parseReservationId(id: string): Types.ObjectId | null {
  return OBJECT_ID.test(id) ? new Types.ObjectId(id) : null;
}
