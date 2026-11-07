import { Types } from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAY = "2026-11-14";
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Test-only pause after every claim, so competing requests overlap in time. */
const pausing = buildTestApp({ now: NOW, afterClaim: () => sleep(2) });

type Interval = { reservationId: Types.ObjectId; start: Date; end: Date };

function assertNoOverlap(label: string, intervals: Interval[]) {
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i]!;
      const b = intervals[j]!;
      expect(a.start < b.end && b.start < a.end, `${label}: ${i} overlaps ${j}`).toBe(false);
    }
  }
}

/** The end-of-round invariants: no overlap, no orphan interval, nothing on a removed table. */
async function assertConsistent() {
  const reservations = await Reservation.find({}).lean();
  const ids = new Set(reservations.map((r) => r._id.toHexString()));
  const days = [
    ...(await TableDay.find({}).lean()).map((d) => ({ label: "TableDay", intervals: d.intervals })),
    ...(await GuestDay.find({}).lean()).map((d) => ({ label: "GuestDay", intervals: d.intervals })),
  ];
  for (const day of days) {
    assertNoOverlap(day.label, day.intervals);
    for (const interval of day.intervals) {
      expect(ids.has(interval.reservationId.toHexString()), "orphan interval").toBe(true);
    }
  }
  const removed = new Set(
    (await Table.find({ removed: true }).lean()).map((t) => t._id.toHexString()),
  );
  for (const r of reservations) expect(removed.has(r.tableId.toHexString())).toBe(false);
  // every reservation has its table interval and its guest interval
  for (const r of reservations) {
    const tableDay = await TableDay.findOne({ tableId: r.tableId, date: r.date }).lean();
    const guestDay = await GuestDay.findOne({ email: r.guestEmail, date: r.date }).lean();
    expect(tableDay?.intervals.some((i) => i.reservationId.equals(r._id))).toBe(true);
    expect(guestDay?.intervals.some((i) => i.reservationId.equals(r._id))).toBe(true);
  }
}

async function clearBookings() {
  await Promise.all([Reservation.deleteMany({}), TableDay.deleteMany({}), GuestDay.deleteMany({})]);
}

describe("SC-002: one remaining table, 20 simultaneous requests", () => {
  beforeEach(async () => {
    await seedRestaurant({
      tables: [
        { name: "T2", capacity: 2 },
        { name: "T4", capacity: 4 },
      ],
      schedule: { saturday: [DINNER] },
    });
  });

  it("exactly one 201 and 19 no_table_free, in each of 50 rounds", async () => {
    for (let round = 0; round < 50; round++) {
      await clearBookings();
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_v, i) =>
          reserveAs(pausing, {
            partySize: 4,
            time: round % 2 === 0 ? "20:00" : "20:30", // overlapping, never identical across rounds
            email: `guest${i}@mail.com`,
          }),
        ),
      );
      const created = responses.filter((r) => r.status === 201);
      expect(created.length, `round ${round}: successes`).toBe(1);
      for (const r of responses.filter((x) => x.status !== 201)) {
        const error = expectError(r, 409, "NO_AVAILABILITY");
        expect(error.details).toEqual({ reason: "no_table_free" });
      }
      expect(await Reservation.countDocuments({}), `round ${round}`).toBe(1);
      await assertConsistent();
      // the 19 losers released their guest holds
      const guestIntervals = (await GuestDay.find({}).lean()).reduce((n, d) => n + d.intervals.length, 0);
      expect(guestIntervals).toBe(1);
    }
  }, 180_000);

  it("different, overlapping start times also yield a single winner", async () => {
    const times = ["18:00", "18:30", "19:00", "19:30", "19:59", "18:15", "19:15", "18:45"];
    const responses = await Promise.all(
      times.map((time, i) => reserveAs(pausing, { partySize: 4, time, email: `g${i}@mail.com` })),
    );
    // 18:00-20:00 and 19:59-21:59 still overlap, so all eight ranges conflict pairwise.
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of responses.filter((x) => x.status !== 201)) expectError(r, 409, "NO_AVAILABILITY");
    await assertConsistent();
  });
});

describe("FR-026: the same guest, simultaneously", () => {
  beforeEach(async () => {
    await seedRestaurant({
      tables: [
        { name: "T4a", capacity: 4 },
        { name: "T4b", capacity: 4 },
        { name: "T4c", capacity: 4 },
      ],
      schedule: { saturday: [DINNER] },
    });
  });

  it("two identical requests with free tables: one 201 and one duplicate_reservation", async () => {
    for (let round = 0; round < 10; round++) {
      await clearBookings();
      const responses = await Promise.all([
        reserveAs(pausing, { email: "ana@mail.com" }),
        reserveAs(pausing, { email: " ANA@mail.com " }),
      ]);
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses, `round ${round}`).toEqual([201, 409]);
      const refused = responses.find((r) => r.status === 409)!;
      const error = expectError(refused, 409, "CONFLICT");
      expect(error.details).toEqual({ reason: "duplicate_reservation" });
      expect(await Reservation.countDocuments({})).toBe(1);
      await assertConsistent();
    }
  });

  it("ten simultaneous identical requests: exactly one succeeds", async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => reserveAs(pausing, { email: "ana@mail.com" })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of responses.filter((x) => x.status !== 201)) expectError(r, 409, "CONFLICT");
    await assertConsistent();
  });
});

describe("candidate fallback", () => {
  beforeEach(async () => {
    await seedRestaurant({
      tables: [
        { name: "T2", capacity: 2 },
        { name: "T4a", capacity: 4 },
        { name: "T4b", capacity: 4 },
        { name: "T6", capacity: 6 },
      ],
      schedule: { saturday: [DINNER] },
    });
  });

  it("simultaneous requests each get a different table, smallest suitable first, no overlap", async () => {
    // Four parties of 3 compete for T4a, T4b, T6: three succeed, one is refused.
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_v, i) =>
        reserveAs(pausing, { partySize: 3, email: `fb${i}@mail.com` }),
      ),
    );
    const created = responses.filter((r) => r.status === 201);
    expect(created).toHaveLength(3);
    const tables = created.map((r) => (r.body as { table: { name: string } }).table.name).sort();
    expect(tables).toEqual(["T4a", "T4b", "T6"]);
    for (const r of responses.filter((x) => x.status !== 201)) {
      expect(expectError(r, 409, "NO_AVAILABILITY").details).toEqual({ reason: "no_table_free" });
    }
    await assertConsistent();
  });

  it("two simultaneous parties of 4 take T4a and T4b, never the larger table", async () => {
    const responses = await Promise.all([
      reserveAs(pausing, { partySize: 4, email: "x@mail.com" }),
      reserveAs(pausing, { partySize: 4, email: "y@mail.com" }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const names = responses.map((r) => (r.body as { table: { name: string } }).table.name).sort();
    expect(names).toEqual(["T4a", "T4b"]);
  });
});

describe("a request that fails after its guest claim", () => {
  beforeEach(async () => {
    await seedRestaurant({
      tables: [{ name: "T4", capacity: 4 }],
      schedule: { saturday: [DINNER] },
    });
  });

  it("holds the guest only while it runs; a later attempt succeeds", async () => {
    let entered!: () => void;
    const hasEntered = new Promise<void>((resolve) => (entered = resolve));
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let first = true;

    const app = buildTestApp({
      now: NOW,
      afterClaim: async (event) => {
        if (event.stage !== "guest" || !first) return;
        first = false;
        entered();
        await gate;
        throw new Error("forced failure after the guest claim");
      },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const firstRequest = reserveAs(app, { email: "ana@mail.com" }).then((r) => r);
    await hasEntered;

    // The second request meets the first one's guest hold (or its pre-read): a duplicate.
    const second = await reserveAs(app, { email: "ana@mail.com" });
    expect(expectError(second, 409, "CONFLICT").details).toEqual({ reason: "duplicate_reservation" });

    open();
    expectError(await firstRequest, 500, "INTERNAL_ERROR");
    errorLog.mockRestore();

    // The first request released its guest hold: nothing is left and a new attempt works.
    expect(await Reservation.countDocuments({})).toBe(0);
    expect((await GuestDay.find({}).lean()).reduce((n, d) => n + d.intervals.length, 0)).toBe(0);
    const third = await reserveAs(app, { email: "ana@mail.com" });
    expect(third.status).toBe(201);
    await assertConsistent();
  });
});

describe("hook placement", () => {
  it("afterClaim is invoked for the guest claim and for the table claim", async () => {
    await seedRestaurant({ tables: [{ name: "T4", capacity: 4 }], schedule: { saturday: [DINNER] } });
    const stages: string[] = [];
    const app = buildTestApp({ now: NOW, afterClaim: (e) => void stages.push(e.stage) });
    expect((await reserveAs(app)).status).toBe(201);
    expect(stages).toEqual(["guest", "table"]);
  });

  it("a request without hooks behaves the same (the hook is optional)", async () => {
    await seedRestaurant({ tables: [{ name: "T4", capacity: 4 }], schedule: { saturday: [DINNER] } });
    const plain = buildTestApp({ now: NOW });
    expect((await request(plain).post("/reservations").send({
      date: SATURDAY, time: "20:00", partySize: 2, name: "Ana", email: "a@mail.com", phone: "600123456",
    })).status).toBe(201);
  });
});
