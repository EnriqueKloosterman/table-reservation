import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { kept } from "../helpers/keep-alive.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { loginAs } from "../helpers/login-as.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant, type SeededTable } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAY = "2026-11-14";
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const jitter = (max: number) => sleep(Math.floor(Math.random() * max));

let tables: SeededTable[] = [];
let token = "";

type Affected = { id: string };

/** Pauses the reserve flow with a small random delay after each claim. */
const jittery = buildTestApp({ now: NOW, afterClaim: () => jitter(4) });

beforeEach(async () => {
  await seedStaff();
  token = await loginAs(jittery);
  const seeded = await seedRestaurant({
    tables: [
      { name: "A", capacity: 4 },
      { name: "B", capacity: 4 },
    ],
    schedule: { saturday: [DINNER] },
  });
  tables = seeded.tables;
});

afterEach(() => vi.restoreAllMocks());

const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
const tableA = () => tables.find((t) => t.name === "A")!;
const tableB = () => tables.find((t) => t.name === "B")!;

async function resetRound() {
  await Promise.all([Reservation.deleteMany({}), TableDay.deleteMany({}), GuestDay.deleteMany({})]);
  await Table.updateMany({}, { $set: { removed: false, removedAt: null, capacity: 4 } });
  await ClosedDate.deleteMany({});
}

async function assertNoReservationOnRemovedTable() {
  const removed = new Set((await Table.find({ removed: true }).lean()).map((t) => t._id.toHexString()));
  for (const r of await Reservation.find({}).lean()) {
    expect(removed.has(r.tableId.toHexString()), "reservation on a removed table").toBe(false);
  }
}

describe("table removal racing a reservation (FR-029)", () => {
  async function round(order: "removal-first" | "reservation-first") {
    await resetRound();
    const startRemoval = async () => {
      if (order === "reservation-first") await sleep(2);
      return auth(kept(jittery).delete(`/tables/${tableA().id}`));
    };
    const startReservation = async () => {
      if (order === "removal-first") await sleep(2);
      return reserveAs(jittery, { date: SATURDAY, time: "20:00", partySize: 4 });
    };
    const [removal, reservation] = await Promise.all([startRemoval(), startReservation()]);

    await assertNoReservationOnRemovedTable();
    const stored = await Reservation.countDocuments({});

    if (removal.status === 204) {
      // Either the reservation went to the other table or it was refused; never to A.
      expect((await Table.findById(tableA().id).lean())!.removed).toBe(true);
      if (reservation.status === 201) {
        expect((reservation.body as { table: { name: string } }).table.name).toBe("B");
        expect(stored).toBe(1);
      } else {
        expectError(reservation, 409, "NO_AVAILABILITY");
        expect(stored).toBe(0);
      }
    } else {
      // The removal backed off: the table is active again when the refusal is sent.
      const error = expectError(removal, 409, "CONFLICT");
      expect(error.details).toEqual({ reason: "table_has_upcoming_reservations" });
      const a = await Table.findById(tableA().id).lean();
      expect(a!.removed).toBe(false);
      expect(a!.removedAt).toBeNull();
      if (reservation.status === 201) {
        expect(stored).toBe(1);
      } else {
        // Accepted by FR-029 / R10: while the removal was being decided the reservation's
        // post-store check may have seen the table as removed and rolled back. Nothing is stored.
        const refusal = expectError(reservation, 409, "NO_AVAILABILITY");
        expect(refusal.details).toEqual({ reason: "no_table_free" });
        expect(stored).toBe(0);
      }
    }
    // Whatever the outcome, no time hold is left without its reservation.
    const ids = new Set((await Reservation.find({}).lean()).map((r) => r._id.toHexString()));
    for (const day of [...(await TableDay.find({}).lean()), ...(await GuestDay.find({}).lean())]) {
      for (const interval of day.intervals) expect(ids.has(interval.reservationId.toHexString())).toBe(true);
    }
  }

  it("removal first, many rounds: never a reservation on a removed table", async () => {
    for (let i = 0; i < 40; i++) await round("removal-first");
  }, 120_000);

  it("reservation first, many rounds: never a reservation on a removed table", async () => {
    for (let i = 0; i < 40; i++) await round("reservation-first");
  }, 120_000);

  it("forced: the reservation claims A, the removal arrives before the re-read and is refused", async () => {
    await resetRound();
    let removalStatus = 0;
    const app: Express = buildTestApp({
      now: NOW,
      reservationOps: {
        findActiveTable: async (id, partySize) => {
          // between the claim and the re-read, staff try to remove A
          const res = await auth(kept(app).delete(`/tables/${tableA().id}`));
          removalStatus = res.status;
          return (await Table.exists({ _id: id, removed: false, capacity: { $gte: partySize } })) !== null;
        },
      },
    });
    const res = await reserveAs(app, { date: SATURDAY, time: "20:00", partySize: 4 });
    expect(res.status).toBe(201);
    expect((res.body as { table: { name: string } }).table.name).toBe("A");
    expect(removalStatus).toBe(409);
    expect((await Table.findById(tableA().id).lean())!.removed).toBe(false);
  });

  it("forced: the removal completes after the snapshot, so the reservation backs off to B", async () => {
    await resetRound();
    const app: Express = buildTestApp({
      now: NOW,
      afterClaim: async (event) => {
        if (event.stage !== "guest") return;
        // after the snapshot (A looked free) and before the table claims
        const res = await auth(kept(app).delete(`/tables/${tableA().id}`));
        expect(res.status).toBe(204);
      },
    });
    const res = await reserveAs(app, { date: SATURDAY, time: "20:00", partySize: 4 });
    expect(res.status).toBe(201);
    expect((res.body as { table: { name: string } }).table.name).toBe("B");
    expect((await Table.findById(tableA().id).lean())!.removed).toBe(true);
    expect(await TableDay.countDocuments({ tableId: new Types.ObjectId(tableA().id), "intervals.0": { $exists: true } })).toBe(0);
    await assertNoReservationOnRemovedTable();
  });
});

describe("removal re-check and revert (R10)", () => {
  it("a claim made between the pre-check and the write is detected: reverted, then 409", async () => {
    await resetRound();
    const realExists = TableDay.exists.bind(TableDay);
    let calls = 0;
    vi.spyOn(TableDay, "exists").mockImplementation(((filter: Record<string, unknown>) => {
      calls += 1;
      const query = realExists(filter);
      if (calls === 1) {
        // pre-check sees nothing; then a reservation claims A before the removal's write
        return query.then(async (found) => {
          await TableDay.updateOne(
            { tableId: new Types.ObjectId(tableA().id), date: SATURDAY },
            {
              $push: {
                intervals: {
                  reservationId: new Types.ObjectId(),
                  start: new Date(`${SATURDAY}T20:00:00Z`),
                  end: new Date(`${SATURDAY}T22:00:00Z`),
                },
              },
            },
            { upsert: true },
          );
          return found;
        });
      }
      return query;
    }) as unknown as typeof TableDay.exists);

    const res = await auth(kept(jittery).delete(`/tables/${tableA().id}`));
    const error = expectError(res, 409, "CONFLICT");
    expect(error.details).toEqual({ reason: "table_has_upcoming_reservations" });
    expect(calls).toBe(2);
    const a = await Table.findById(tableA().id).lean();
    expect(a!.removed).toBe(false);
    expect(a!.removedAt).toBeNull();
  });

  it("a failing revert is retried once; if it still fails → 500 and the table stays removed", async () => {
    await resetRound();
    const realExists = TableDay.exists.bind(TableDay);
    let calls = 0;
    vi.spyOn(TableDay, "exists").mockImplementation(((filter: Record<string, unknown>) => {
      calls += 1;
      const query = realExists(filter);
      return calls === 1
        ? query.then(async (found) => {
            await TableDay.updateOne(
              { tableId: new Types.ObjectId(tableA().id), date: SATURDAY },
              {
                $push: {
                  intervals: {
                    reservationId: new Types.ObjectId(),
                    start: new Date(`${SATURDAY}T20:00:00Z`),
                    end: new Date(`${SATURDAY}T22:00:00Z`),
                  },
                },
              },
              { upsert: true },
            );
            return found;
          })
        : query;
    }) as unknown as typeof TableDay.exists);
    const revert = vi.spyOn(Table, "updateOne").mockImplementation(() => {
      throw new Error("connection lost");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await auth(kept(jittery).delete(`/tables/${tableA().id}`));
    expectError(res, 500, "INTERNAL_ERROR");
    expect(revert).toHaveBeenCalledTimes(2); // the revert and its single retry
    revert.mockRestore();
    const a = await Table.findById(tableA().id).lean();
    expect(a!.removed).toBe(true); // no double booking is possible; staff can recreate the table
  });

  it("a revert that fails once and then works still answers 409 with the table active", async () => {
    await resetRound();
    const realExists = TableDay.exists.bind(TableDay);
    const realUpdate = Table.updateOne.bind(Table);
    let calls = 0;
    vi.spyOn(TableDay, "exists").mockImplementation(((filter: Record<string, unknown>) => {
      calls += 1;
      const query = realExists(filter);
      return calls === 1
        ? query.then(async (found) => {
            await TableDay.updateOne(
              { tableId: new Types.ObjectId(tableA().id), date: SATURDAY },
              {
                $push: {
                  intervals: {
                    reservationId: new Types.ObjectId(),
                    start: new Date(`${SATURDAY}T20:00:00Z`),
                    end: new Date(`${SATURDAY}T22:00:00Z`),
                  },
                },
              },
              { upsert: true },
            );
            return found;
          })
        : query;
    }) as unknown as typeof TableDay.exists);
    let failed = false;
    vi.spyOn(Table, "updateOne").mockImplementation((...args: Parameters<typeof Table.updateOne>) => {
      if (!failed) {
        failed = true;
        throw new Error("transient");
      }
      return realUpdate(...args);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await auth(kept(jittery).delete(`/tables/${tableA().id}`));
    expect(expectError(res, 409, "CONFLICT").details).toEqual({ reason: "table_has_upcoming_reservations" });
    expect((await Table.findById(tableA().id).lean())!.removed).toBe(false);
  });
});

describe("FR-030: a staff change racing a reservation is either reported or the reservation is refused", () => {
  const allowedRefusals: Record<string, string[]> = {
    closedDate: ["closed_date"],
    schedule: ["closed_day", "outside_service_hours"],
    capacity: ["party_too_large", "no_table_free"],
  };

  async function race(
    kind: "closedDate" | "schedule" | "capacity",
    order: "change-first" | "reservation-first",
  ) {
    await resetRound();
    await seedRestaurant({ schedule: { saturday: [DINNER] } });

    const change = async () => {
      if (order === "reservation-first") await sleep(3);
      else await jitter(2);
      if (kind === "closedDate") {
        return auth(kept(jittery).post("/closed-dates")).send({ date: SATURDAY });
      }
      if (kind === "schedule") {
        return auth(kept(jittery).put("/schedule")).send({
          days: [{ day: "saturday", periods: [{ name: "Lunch", start: "12:00", end: "15:00" }] }],
        });
      }
      // reduce every table below the party size
      const first = await auth(kept(jittery).patch(`/tables/${tableA().id}`)).send({ capacity: 2 });
      const second = await auth(kept(jittery).patch(`/tables/${tableB().id}`)).send({ capacity: 2 });
      return { first, second };
    };
    const reserve = async () => {
      if (order === "change-first") await sleep(3);
      return reserveAs(jittery, { date: SATURDAY, time: "20:00", partySize: 4 });
    };

    const [changed, reservation] = await Promise.all([change(), reserve()]);
    const reported = (res: request.Response): string[] =>
      ((res.body as { affectedReservations?: Affected[] }).affectedReservations ?? []).map((a) => a.id);

    if (reservation.status === 201) {
      const id = (reservation.body as { id: string }).id;
      const lists =
        "first" in changed
          ? [...reported(changed.first), ...reported(changed.second)]
          : reported(changed);
      // stored → the staff response lists it (it may be listed and later rolled back: both fine)
      expect(lists, `${kind} ${order}: stored but not reported`).toContain(id);
      expect(await Reservation.countDocuments({ _id: id })).toBeLessThanOrEqual(1);
    } else {
      const error = expectError(reservation, 409, "NO_AVAILABILITY");
      const reason = (error.details as { reason: string }).reason;
      expect(allowedRefusals[kind], `${kind} ${order}: ${reason}`).toContain(reason);
      expect(await Reservation.countDocuments({})).toBe(0);
    }
    // whatever happened, no hold is left without a reservation
    const reservations = new Set((await Reservation.find({}).lean()).map((r) => r._id.toHexString()));
    for (const day of await TableDay.find({}).lean()) {
      for (const i of day.intervals) expect(reservations.has(i.reservationId.toHexString())).toBe(true);
    }
    for (const day of await GuestDay.find({}).lean()) {
      for (const i of day.intervals) expect(reservations.has(i.reservationId.toHexString())).toBe(true);
    }
  }

  it.each(["closedDate", "schedule", "capacity"] as const)("%s, both orderings, many rounds", async (kind) => {
    for (let i = 0; i < 20; i++) {
      await race(kind, "change-first");
      await race(kind, "reservation-first");
    }
  }, 180_000);

  it("forced: a closed date applied between the claim and the insert is reported or refused", async () => {
    await resetRound();
    // the closed date is added after the reservation passes its re-read: verification rolls it back
    const app: Express = buildTestApp({
      now: NOW,
      afterClaim: async (event) => {
        if (event.stage !== "table") return;
        const res = await auth(kept(app).post("/closed-dates")).send({ date: SATURDAY });
        expect(res.status).toBe(201);
      },
    });
    const res = await reserveAs(app, { date: SATURDAY, time: "20:00", partySize: 4 });
    expect(expectError(res, 409, "NO_AVAILABILITY").details).toEqual({ reason: "closed_date" });
    expect(await Reservation.countDocuments({})).toBe(0);
  });
});
