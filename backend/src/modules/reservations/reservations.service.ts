import { Types, Error as MongooseError } from "mongoose";
import type { Config } from "../../config/env.js";
import type { Clock } from "../../shared/clock.js";
import {
  alreadyCancelled,
  AppError,
  cannotCancel,
  conflict,
  noAvailability,
  notFound,
  type AvailabilityReason,
} from "../../shared/errors/app-error.js";
import { dayOfWeek, localToUtc, overlaps, utcToLocal } from "../../shared/time/local-time.js";
import {
  checkAvailability,
  fitsInsideAPeriod,
} from "../availability/availability.domain.js";
import type { Notifier } from "../notifications/notifier.js";
import { loadDaySnapshot } from "../availability/availability.snapshot.js";
import { GuestDay, TableDay } from "./calendar.model.js";
import type { ClaimModel } from "./interval-claims.js";
import { Reservation } from "./reservation.model.js";
import {
  defaultReservationOps,
  type ConfigState,
  type ReservationOps,
  type ReservationTestHooks,
} from "./reservations.ops.js";
import type {
  CancellationResult,
  CreateReservationInput,
  ReservationConfirmation,
} from "./reservations.schemas.js";
import { generateSecretCode, hashSecretCode } from "./secret-code.js";

export type ReservationDeps = {
  config: Config;
  clock: Clock;
  /** Starts emails in the background; callers never await it. */
  notifier: Notifier;
  /** Test-only; never set by the production wiring. */
  testHooks?: ReservationTestHooks | undefined;
};

const MINUTE_MS = 60_000;

const duplicateReservation = () =>
  conflict("A reservation for this guest already overlaps the requested time", {
    reason: "duplicate_reservation",
  });

/** The same generic body as any unexpected failure; nothing internal is disclosed. */
const internalError = () => new AppError("INTERNAL_ERROR", "An unexpected error occurred");

/**
 * Was the insert definitely refused by the database (so nothing was stored)? Anything else,
 * such as a lost connection or a timeout, leaves the outcome unknown (FR-027b).
 */
function isDefiniteWriteFailure(err: unknown): boolean {
  if (err instanceof MongooseError.ValidationError) return true;
  const name = (err as { name?: unknown } | null)?.name;
  return name === "MongoServerError" || name === "ValidationError";
}

/** The first configuration check that no longer holds after the reservation was stored. */
function verificationFailure(
  state: ConfigState,
  time: string,
  partySize: number,
  durationMinutes: number,
): AvailabilityReason | null {
  if (state.isClosedDate) return "closed_date";
  if (state.periods.length === 0) return "closed_day";
  if (!fitsInsideAPeriod(state.periods, time, durationMinutes)) return "outside_service_hours";
  if (!state.table || state.table.removed || state.table.capacity < partySize) return "no_table_free";
  return null;
}

type Hold = { model: ClaimModel; key: Record<string, unknown> };

/**
 * Creates a confirmed reservation following research R6: duplicate pre-read → availability →
 * guest claim → table claims with re-check → insert → post-store verification. Every failure
 * path releases what it took, except where the outcome is unknown and a hold is the safe side.
 * Database failures surface as INTERNAL_ERROR, never as a conflict or "no table free".
 */
export async function createReservation(
  input: CreateReservationInput,
  deps: ReservationDeps,
): Promise<ReservationConfirmation> {
  try {
    return await reserve(input, deps);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Reservation failed:", err);
    throw internalError();
  }
}

async function reserve(
  { date, time, partySize, name, email, phone }: CreateReservationInput,
  { config, clock, testHooks, notifier }: ReservationDeps,
): Promise<ReservationConfirmation> {
  const ops: ReservationOps = { ...defaultReservationOps, ...testHooks?.ops };
  const timeZone = config.RESTAURANT_TIME_ZONE;

  // 2. The requested range. A nonexistent local time (DST gap) has none.
  const startAt = localToUtc(date, time, timeZone);
  const endAt = startAt && new Date(startAt.getTime() + config.RESERVATION_DURATION_MINUTES * MINUTE_MS);

  // 3. Duplicate pre-read: refused before availability is considered.
  if (startAt && endAt) {
    const day = await GuestDay.findOne({ email, date }).lean();
    if (day?.intervals.some((i) => overlaps(i, { start: startAt, end: endAt }))) {
      throw duplicateReservation();
    }
  }

  // 4. Availability on a fresh snapshot.
  const snapshot = await loadDaySnapshot(date, { config, clock });
  const availability = checkAvailability(snapshot, { time, partySize });
  if (!availability.available) throw noAvailability(availability.reason);
  if (!startAt || !endAt) throw internalError(); // unreachable: available implies a real start

  // 5. Identity and creation time.
  const reservationId = new Types.ObjectId();
  const createdAt = clock.now();
  const interval = { reservationId, start: startAt, end: endAt };

  // Holds taken so far, released in reverse order on any failure that is not "unknown".
  const held: Hold[] = [];
  const releaseHeld = async () => {
    for (const hold of held.splice(0).reverse()) {
      try {
        await ops.release(hold.model, hold.key, reservationId);
      } catch (err) {
        // An orphan hold can only hide a time (FR-031); the original answer stands.
        console.error("Could not release a time hold:", err);
      }
    }
  };
  /** After an ambiguous claim: it may have succeeded, so try to undo it, best effort. */
  const releaseQuietly = async (hold: Hold) => {
    try {
      await ops.release(hold.model, hold.key, reservationId);
    } catch (err) {
      console.error("Could not release a time hold:", err);
    }
  };

  try {
    // 6. Guest claim: what makes simultaneous requests with the same email safe (FR-026).
    const guestHold: Hold = { model: GuestDay, key: { email, date } };
    let guestClaimed: boolean;
    try {
      guestClaimed = await ops.claim(guestHold.model, guestHold.key, interval);
    } catch (err) {
      await releaseQuietly(guestHold);
      throw err;
    }
    if (!guestClaimed) throw duplicateReservation();
    held.push(guestHold);
    await testHooks?.afterClaim?.({ stage: "guest", reservationId: reservationId.toHexString(), email });

    // 7. Table claims in FR-010 order; a lost claim falls back to the next candidate.
    let assigned: { id: string; name: string } | undefined;
    for (const candidate of availability.tables) {
      const tableId = new Types.ObjectId(candidate.id);
      const tableHold: Hold = { model: TableDay, key: { tableId, date } };
      let claimed: boolean;
      try {
        claimed = await ops.claim(tableHold.model, tableHold.key, interval);
      } catch (err) {
        await releaseQuietly(tableHold);
        throw err;
      }
      if (!claimed) continue;
      held.push(tableHold);
      if (await ops.findActiveTable(tableId, partySize)) {
        assigned = candidate;
        break;
      }
      held.pop();
      await releaseQuietly(tableHold);
    }
    if (!assigned) throw noAvailability("no_table_free");
    const tableId = new Types.ObjectId(assigned.id);
    await testHooks?.afterClaim?.({
      stage: "table",
      reservationId: reservationId.toHexString(),
      email,
      tableId: assigned.id,
    });

    // 8. Insert. A definite refusal releases; an unknown outcome is resolved first (FR-027b).
    const secretCode = generateSecretCode();
    const endTime = utcToLocal(endAt, timeZone).time;
    try {
      await ops.insertReservation({
        _id: reservationId,
        tableId,
        date,
        startTime: time,
        endTime,
        startAt,
        endAt,
        partySize,
        guestName: name,
        guestEmail: email,
        guestPhone: phone,
        secretCodeHash: hashSecretCode(secretCode),
        createdAt,
      });
    } catch (err) {
      if (isDefiniteWriteFailure(err)) throw err;
      let stored: boolean;
      try {
        stored = await ops.reservationExists(reservationId);
      } catch (checkErr) {
        // Cannot tell: keep both holds. An extra hold only hides a time; a missing one could
        // allow a double booking.
        console.error("Could not confirm whether the reservation was stored:", checkErr);
        held.length = 0;
        throw err;
      }
      if (!stored) throw err;
    }

    // 9. Post-store verification against the configuration now (FR-030).
    let state: ConfigState | undefined;
    try {
      state = await ops.loadConfigState(date, dayOfWeek(date), tableId);
    } catch (err) {
      // The reservation passed every check at step 7; keep it.
      console.error("Post-store verification could not read the configuration:", err);
    }
    if (state) {
      const reason = verificationFailure(state, time, partySize, config.RESERVATION_DURATION_MINUTES);
      if (reason) {
        try {
          await ops.deleteReservation(reservationId);
        } catch (err) {
          held.length = 0; // the reservation still exists with both holds
          throw err;
        }
        throw noAvailability(reason);
      }
    }

    // 10. Confirmation, including the plain secret code (returned only here).
    const confirmation: ReservationConfirmation = {
      id: reservationId.toHexString(),
      status: "confirmed",
      date,
      startTime: time,
      endTime,
      partySize,
      guest: { name, email, phone },
      table: { name: assigned.name },
      createdAt: createdAt.toISOString(),
      secretCode,
    };
    // 11. The email starts in the background and is never awaited (FR-003). It is the last step,
    // after the post-store verification, so a refused or failed request never reaches it.
    notifier.notifyConfirmation(
      { id: confirmation.id, guestName: name, guestEmail: email, date, startTime: time, endTime, partySize },
      secretCode,
    );
    return confirmation;
  } catch (err) {
    await releaseHeld();
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Cancellation (feature 003, research R2, R3, R7)
// ---------------------------------------------------------------------------------------------

/** Who is cancelling and how the reservation is identified. */
export type CancelTarget = { by: "guest"; code: string } | { by: "staff"; id: string };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const NOT_FOUND_MESSAGE = "Reservation not found";

/** The fields the cancellation reads from a stored reservation (never the code or its hash). */
type CancelRecord = {
  _id: Types.ObjectId;
  tableId: Types.ObjectId;
  date: string;
  startTime: string;
  endTime: string;
  startAt: Date;
  partySize: number;
  guestName: string;
  guestEmail: string;
  status: string;
  cancelledAt?: Date | null | undefined;
};

/** A string-only name for logs: error messages can hold addresses or codes and are never read. */
const errorName = (err: unknown): string => (err instanceof Error ? err.name : "Unknown");

/**
 * Cancels an upcoming confirmed reservation. The status flip is one atomic conditional write
 * and happens BEFORE the releases (R2), so concurrent callers produce exactly one winner and a
 * failed release can only hide a time, never double-book it. Only the winner releases and
 * emails. A cancellation that cannot release everything is an INTERNAL_ERROR with no email, and
 * a later request carrying the same code repairs the release (R3).
 */
export async function cancelReservation(target: CancelTarget, deps: ReservationDeps): Promise<CancellationResult> {
  try {
    return await cancel(target, deps);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error(JSON.stringify({ event: "cancel_failed", reason: errorName(err) }));
    throw internalError();
  }
}

async function cancel(target: CancelTarget, deps: ReservationDeps): Promise<CancellationResult> {
  const { clock, notifier, testHooks } = deps;
  const ops: ReservationOps = { ...defaultReservationOps, ...testHooks?.ops };
  const now = clock.now(); // read once per request

  // 1. Resolve. The code is hashed exactly as sent, so every non-matching string behaves alike.
  let found: { _id: Types.ObjectId } | null;
  if (target.by === "guest") {
    found = await Reservation.findOne({ secretCodeHash: hashSecretCode(target.code) }, { _id: 1 }).lean();
  } else {
    found = OBJECT_ID.test(target.id) ? await Reservation.findById(target.id, { _id: 1 }).lean() : null;
  }
  if (!found) throw notFound(NOT_FOUND_MESSAGE);

  // 2. The atomic claim: the single gate among any number of simultaneous callers (FR-015).
  const claimed: CancelRecord | null = await Reservation.findOneAndUpdate(
    { _id: found._id, status: "confirmed", startAt: { $gt: now } },
    { $set: { status: "cancelled", cancelledAt: now, cancelledBy: target.by } },
    { new: true },
  ).lean();

  if (!claimed) {
    // 3. Lost or refused: one re-read decides the answer.
    const current: CancelRecord | null = await Reservation.findById(found._id).lean();
    if (!current) throw notFound(NOT_FOUND_MESSAGE);
    if (current.status === "cancelled") {
      // Repair release: idempotent, changes no state, sends no email.
      if (!(await releaseBoth(current, ops))) throw internalError();
      throw alreadyCancelled();
    }
    if (current.startAt.getTime() <= now.getTime()) throw cannotCancel();
    throw internalError(); // unreachable: confirmed and upcoming would have been claimed
  }

  // 4. The winner releases the table and the guest slot; never report success otherwise.
  if (!(await releaseBoth(claimed, ops))) throw internalError();

  // 5. Email in the background, never awaited (FR-003, FR-014).
  notifier.notifyCancellation({
    id: claimed._id.toHexString(),
    guestName: claimed.guestName,
    guestEmail: claimed.guestEmail,
    date: claimed.date,
    startTime: claimed.startTime,
    endTime: claimed.endTime,
    partySize: claimed.partySize,
    cancelledBy: target.by,
  });

  return {
    id: claimed._id.toHexString(),
    status: "cancelled",
    date: claimed.date,
    startTime: claimed.startTime,
    endTime: claimed.endTime,
    partySize: claimed.partySize,
    cancelledAt: (claimed.cancelledAt ?? now).toISOString(),
  };
}

/** Releases the table interval and the guest interval; both are always attempted (R3). */
async function releaseBoth(record: CancelRecord, ops: ReservationOps): Promise<boolean> {
  const holds = [
    { kind: "table", model: TableDay, key: { tableId: record.tableId, date: record.date } },
    { kind: "guest", model: GuestDay, key: { email: record.guestEmail, date: record.date } },
  ] as const;
  let allReleased = true;
  for (const hold of holds) {
    let failure: unknown;
    let released = false;
    for (let attempt = 0; attempt < 2 && !released; attempt++) {
      try {
        await ops.release(hold.model, hold.key, record._id);
        released = true;
      } catch (err) {
        failure = err;
      }
    }
    if (!released) {
      allReleased = false;
      console.error(
        JSON.stringify({
          event: "release_failed",
          reservationId: record._id.toHexString(),
          kind: hold.kind,
          reason: errorName(failure),
        }),
      );
    }
  }
  return allReleased;
}
