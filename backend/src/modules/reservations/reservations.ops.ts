import type { Types } from "mongoose";
import { ClosedDate } from "../closed-dates/closed-date.model.js";
import { WEEKLY_SCHEDULE_ID, WeeklySchedule } from "../schedule/schedule.model.js";
import type { DayName, ServicePeriod } from "../schedule/schedule.domain.js";
import { Table } from "../tables/table.model.js";
import { Reservation } from "./reservation.model.js";
import { claimInterval, releaseInterval, type ClaimModel, type ClaimedInterval } from "./interval-claims.js";

export type NewReservation = {
  _id: Types.ObjectId;
  tableId: Types.ObjectId;
  date: string;
  startTime: string;
  endTime: string;
  startAt: Date;
  endAt: Date;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  secretCodeHash: string;
  createdAt: Date;
};

/** Configuration as it is now, for the post-store verification (FR-030). */
export type ConfigState = {
  isClosedDate: boolean;
  periods: ServicePeriod[];
  table: { removed: boolean; capacity: number } | null;
};

/**
 * Every database operation of the reserve flow that can fail on its own. The defaults use
 * the models; tests replace single entries (through `buildTestApp`) to simulate failures.
 */
export type ReservationOps = {
  claim: (model: ClaimModel, key: Record<string, unknown>, interval: ClaimedInterval) => Promise<boolean>;
  release: (model: ClaimModel, key: Record<string, unknown>, reservationId: Types.ObjectId) => Promise<void>;
  /** Re-read after a table claim: is the table still active and big enough? */
  findActiveTable: (tableId: Types.ObjectId, partySize: number) => Promise<boolean>;
  insertReservation: (doc: NewReservation) => Promise<void>;
  reservationExists: (id: Types.ObjectId) => Promise<boolean>;
  deleteReservation: (id: Types.ObjectId) => Promise<void>;
  loadConfigState: (date: string, day: DayName, tableId: Types.ObjectId) => Promise<ConfigState>;
};

export const defaultReservationOps: ReservationOps = {
  claim: claimInterval,
  release: releaseInterval,

  findActiveTable: async (tableId, partySize) =>
    (await Table.exists({ _id: tableId, removed: false, capacity: { $gte: partySize } })) !== null,

  insertReservation: async (doc) => {
    await Reservation.create(doc);
  },

  reservationExists: async (id) => (await Reservation.exists({ _id: id })) !== null,

  deleteReservation: async (id) => {
    await Reservation.deleteOne({ _id: id });
  },

  loadConfigState: async (date, day, tableId) => {
    const [closed, schedule, table] = await Promise.all([
      ClosedDate.exists({ date }),
      WeeklySchedule.findById(WEEKLY_SCHEDULE_ID).lean(),
      Table.findById(tableId, { removed: 1, capacity: 1 }).lean(),
    ]);
    return {
      isClosedDate: closed !== null,
      periods: (schedule?.days.find((d) => d.day === day)?.periods ?? []).map(({ name, start, end }) => ({
        name,
        start,
        end,
      })),
      table: table ? { removed: table.removed === true, capacity: table.capacity } : null,
    };
  },
};

/** Which claim of the reserve flow just succeeded (test-only hook). */
export type ClaimEvent = {
  stage: "guest" | "table";
  reservationId: string;
  email: string;
  tableId?: string;
};

/**
 * Test-only hooks. Production wiring (`server.ts`) never passes them; only `buildTestApp`
 * does. `afterClaim` runs right after the guest claim and after the table claim and its
 * re-read, which lets tests force contention or change the configuration mid-request.
 */
export type ReservationTestHooks = {
  afterClaim?: (event: ClaimEvent) => void | Promise<void>;
  ops?: Partial<ReservationOps>;
};
