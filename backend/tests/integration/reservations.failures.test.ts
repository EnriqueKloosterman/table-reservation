import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import {
  defaultReservationOps,
  type ReservationOps,
} from "../../src/modules/reservations/reservations.ops.js";
import { WEEKLY_SCHEDULE_ID, WeeklySchedule } from "../../src/modules/schedule/schedule.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp, type BuildTestAppOptions } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAY = "2026-11-14";
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

const ops = defaultReservationOps;

/** A server-side rejection: the database definitely did not store the document. */
const definiteError = () => Object.assign(new Error("document failed validation"), { name: "MongoServerError", code: 121 });
/** A lost connection: nobody knows whether the write happened. */
const networkError = () => Object.assign(new Error("connection lost"), { name: "MongoNetworkError" });

function appWith(options: BuildTestAppOptions) {
  return buildTestApp({ now: NOW, ...options });
}

async function counts() {
  const tables = (await TableDay.find({}).lean()).reduce((n, d) => n + d.intervals.length, 0);
  const guests = (await GuestDay.find({}).lean()).reduce((n, d) => n + d.intervals.length, 0);
  return {
    reservations: await Reservation.countDocuments({}),
    tableIntervals: tables,
    guestIntervals: guests,
  };
}

let errorLog: MockInstance<typeof console.error>;

beforeEach(async () => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  await seedRestaurant({
    tables: [{ name: "T4", capacity: 4 }],
    schedule: { saturday: [DINNER] },
  });
});

afterEach(() => vi.restoreAllMocks());

const reserve = (app: ReturnType<typeof appWith>, over: Record<string, unknown> = {}) =>
  reserveAs(app, { partySize: 4, ...over });

describe("insert failures (FR-027a, b)", () => {
  it("a definite insert error → 500, table and guest holds released", async () => {
    const app = appWith({
      reservationOps: { insertReservation: () => Promise.reject(definiteError()) },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("a duplicate-key insert error is an internal error, never a CONFLICT", async () => {
    const dup = Object.assign(new Error("E11000 duplicate key"), { name: "MongoServerError", code: 11000 });
    const app = appWith({ reservationOps: { insertReservation: () => Promise.reject(dup) } });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("unknown outcome, the write succeeded → exists finds it → 201 and holds kept", async () => {
    const app = appWith({
      reservationOps: {
        insertReservation: async (doc) => {
          await ops.insertReservation(doc);
          throw networkError();
        },
      },
    });
    const res = await reserve(app);
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ reservations: 1, tableIntervals: 1, guestIntervals: 1 });
  });

  it("unknown outcome, the write did not happen → 500 and both holds released", async () => {
    const app = appWith({
      reservationOps: { insertReservation: () => Promise.reject(networkError()) },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("unknown outcome and the existence check also fails → 500 and both holds kept", async () => {
    const app = appWith({
      reservationOps: {
        insertReservation: () => Promise.reject(networkError()),
        reservationExists: () => Promise.reject(networkError()),
      },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 1, guestIntervals: 1 });
  });
});

describe("claim failures (FR-027c)", () => {
  it("a database error on the table claim → 500 (not no_table_free), guest hold released", async () => {
    const app = appWith({
      reservationOps: {
        claim: (model, key, interval) =>
          model === TableDay ? Promise.reject(networkError()) : ops.claim(model, key, interval),
      },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("a database error on the guest claim → 500 (not duplicate_reservation)", async () => {
    const app = appWith({
      reservationOps: {
        claim: (model, key, interval) =>
          model === GuestDay ? Promise.reject(networkError()) : ops.claim(model, key, interval),
      },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("a duplicate-key error escaping a claim is an internal error, never a CONFLICT", async () => {
    const dup = Object.assign(new Error("E11000"), { name: "MongoServerError", code: 11000 });
    const app = appWith({
      reservationOps: {
        claim: (model, key, interval) =>
          model === TableDay ? Promise.reject(dup) : ops.claim(model, key, interval),
      },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("a database error while re-reading the table → 500, both holds released", async () => {
    const app = appWith({
      reservationOps: { findActiveTable: () => Promise.reject(networkError()) },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });

  it("a database error while reading the snapshot → 500 and nothing was taken", async () => {
    vi.spyOn(Table, "find").mockImplementationOnce(() => {
      throw networkError();
    });
    expectError(await reserve(appWith({})), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  });
});

describe("failing releases", () => {
  it("a failing table release does not mask the original answer nor stop the guest release", async () => {
    const releases: string[] = [];
    const app = appWith({
      reservationOps: {
        insertReservation: () => Promise.reject(definiteError()),
        release: async (model, key, id) => {
          releases.push(model === TableDay ? "table" : "guest");
          if (model === TableDay) throw networkError();
          await ops.release(model, key, id);
        },
      },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(releases).toEqual(["table", "guest"]); // reverse order of acquisition, both attempted
    // the table hold is an orphan (safe direction); the guest hold was released
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 1, guestIntervals: 0 });
  });

  it("a failing guest release on a lost race still answers no_table_free", async () => {
    // The snapshot sees the table free; a competitor claims it right after our guest claim.
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage !== "guest") return;
        const table = (await Table.findOne({ name: "T4" }).lean())!;
        await TableDay.updateOne(
          { tableId: table._id, date: SATURDAY },
          {
            $push: {
              intervals: {
                reservationId: new Types.ObjectId(),
                start: new Date(`${SATURDAY}T19:00:00Z`),
                end: new Date(`${SATURDAY}T21:00:00Z`),
              },
            },
          },
          { upsert: true },
        );
      },
      reservationOps: {
        release: (model, key, id) =>
          model === GuestDay ? Promise.reject(networkError()) : ops.release(model, key, id),
      },
    });
    const res = await reserve(app, { time: "20:00" });
    expect(expectError(res, 409, "NO_AVAILABILITY").details).toEqual({ reason: "no_table_free" });
    // the competitor's interval stays; our guest hold is an orphan because its release failed
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 1, guestIntervals: 1 });
  });

  it("a lost race with working releases leaves only the competitor's hold", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage !== "guest") return;
        const table = (await Table.findOne({ name: "T4" }).lean())!;
        await TableDay.updateOne(
          { tableId: table._id, date: SATURDAY },
          {
            $push: {
              intervals: {
                reservationId: new Types.ObjectId(),
                start: new Date(`${SATURDAY}T19:00:00Z`),
                end: new Date(`${SATURDAY}T21:00:00Z`),
              },
            },
          },
          { upsert: true },
        );
      },
    });
    const res = await reserve(app, { time: "20:00" });
    expect(expectError(res, 409, "NO_AVAILABILITY").details).toEqual({ reason: "no_table_free" });
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 1, guestIntervals: 0 });
  });
});

describe("post-store verification (FR-030)", () => {
  async function expectRolledBack(reason: string, app: ReturnType<typeof appWith>) {
    const res = await reserve(app);
    expect(expectError(res, 409, "NO_AVAILABILITY").details).toEqual({ reason });
    expect(await counts()).toEqual({ reservations: 0, tableIntervals: 0, guestIntervals: 0 });
  }

  it("a date closed between the claim and the insert → reservation deleted, closed_date", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage === "table") await ClosedDate.create({ date: SATURDAY, reason: "late" });
      },
    });
    await expectRolledBack("closed_date", app);
  });

  it("a schedule replacement removing the service day → closed_day", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage === "table") {
          await WeeklySchedule.updateOne({ _id: WEEKLY_SCHEDULE_ID }, { $set: { "days.$[d].periods": [] } }, {
            arrayFilters: [{ "d.day": "saturday" }],
          });
        }
      },
    });
    await expectRolledBack("closed_day", app);
  });

  it("a schedule replacement that no longer contains the reservation → outside_service_hours", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage === "table") {
          await WeeklySchedule.updateOne({ _id: WEEKLY_SCHEDULE_ID }, {
            $set: { "days.$[d].periods": [{ name: "Early", start: "12:00", end: "15:00" }] },
          }, { arrayFilters: [{ "d.day": "saturday" }] });
        }
      },
    });
    await expectRolledBack("outside_service_hours", app);
  });

  it("a capacity reduction below the party → no_table_free", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage === "table") await Table.updateOne({ name: "T4" }, { $set: { capacity: 2 } });
      },
    });
    await expectRolledBack("no_table_free", app);
  });

  it("a table removal → no_table_free", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage === "table") await Table.updateOne({ name: "T4" }, { $set: { removed: true, removedAt: NOW } });
      },
    });
    await expectRolledBack("no_table_free", app);
  });

  it("if deleting the reservation fails → holds kept and 500", async () => {
    const app = appWith({
      afterClaim: async (e) => {
        if (e.stage === "table") await ClosedDate.create({ date: SATURDAY });
      },
      reservationOps: { deleteReservation: () => Promise.reject(networkError()) },
    });
    expectError(await reserve(app), 500, "INTERNAL_ERROR");
    expect(await counts()).toEqual({ reservations: 1, tableIntervals: 1, guestIntervals: 1 });
  });

  it("reads failing at verification keep the reservation and answer 201", async () => {
    const app = appWith({
      reservationOps: { loadConfigState: () => Promise.reject(networkError()) },
    });
    const res = await reserve(app);
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ reservations: 1, tableIntervals: 1, guestIntervals: 1 });
  });

  it("an unchanged configuration passes verification", async () => {
    const res = await reserve(appWith({}));
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ reservations: 1, tableIntervals: 1, guestIntervals: 1 });
  });
});

describe("the code never reaches the logs on failure", () => {
  it("a failing request logs nothing that contains a secret code or its hash", async () => {
    const app = appWith({ reservationOps: { insertReservation: () => Promise.reject(definiteError()) } });
    await reserve(app);
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(logged).not.toMatch(/[0-9a-f]{64}/);
  });

  it("the ops type is complete", () => {
    const keys: (keyof ReservationOps)[] = [
      "claim",
      "release",
      "findActiveTable",
      "insertReservation",
      "reservationExists",
      "deleteReservation",
      "loadConfigState",
    ];
    for (const key of keys) expect(typeof defaultReservationOps[key]).toBe("function");
  });
});
