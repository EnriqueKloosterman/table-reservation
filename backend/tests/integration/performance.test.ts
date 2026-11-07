import { Types } from "mongoose";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { loginAs } from "../helpers/login-as.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// SC-006 smoke: every management operation answers well under 1 s at this data volume.
const P95_LIMIT_MS = 1000;
const ROUNDS = 10;
const CONCURRENCY = 10;

useTestDatabase();

const app = buildTestApp({ now: new Date("2026-11-06T12:00:00Z") });
let token = "";

/** `count` consecutive calendar dates from `start` (UTC arithmetic on a date-only value). */
function dates(start: string, count: number): string[] {
  const first = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(first + i * 86_400_000).toISOString().slice(0, 10),
  );
}

const SCHEDULE = {
  days: ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({
    day,
    periods: [
      { name: "Lunch", start: "12:00", end: "15:00" },
      { name: "Dinner", start: "20:00", end: "23:30" },
    ],
  })),
};

// Feature 002: 10,000 reservations (50 days x 100 tables x lunch and dinner), each with its
// table and guest interval, written straight through the models.
const BOOKED_DAYS = dates("2026-11-07", 50);
const BOOKED_SLOTS = [
  { start: "12:00", end: "14:00" },
  { start: "20:00", end: "22:00" },
];
/** Service days (Tue-Sun) after the booked range, before the closed dates, within the horizon. */
const FREE_DAYS = ["2026-12-27", "2026-12-29", "2026-12-30", "2026-12-31"];

async function seedReservations(): Promise<void> {
  const tables = await Table.find({}, { _id: 1 }).lean();
  const reservations: Record<string, unknown>[] = [];
  const tableDays: Record<string, unknown>[] = [];
  const guestDays: Record<string, unknown>[] = [];
  let seq = 0;
  for (const date of BOOKED_DAYS) {
    for (const table of tables) {
      const intervals: Record<string, unknown>[] = [];
      for (const slot of BOOKED_SLOTS) {
        const _id = new Types.ObjectId();
        const startAt = new Date(`${date}T${slot.start}:00Z`);
        const endAt = new Date(`${date}T${slot.end}:00Z`);
        const email = `seed${seq++}@mail.com`;
        const interval = { reservationId: _id, start: startAt, end: endAt };
        reservations.push({
          _id,
          tableId: table._id,
          date,
          startTime: slot.start,
          endTime: slot.end,
          startAt,
          endAt,
          partySize: 2,
          guestName: "Seed Guest",
          guestEmail: email,
          guestPhone: "600123456",
          secretCodeHash: "0".repeat(64),
          createdAt: new Date("2026-11-01T00:00:00Z"),
        });
        intervals.push(interval);
        guestDays.push({ email, date, intervals: [interval] });
      }
      tableDays.push({ tableId: table._id, date, intervals });
    }
  }
  await Reservation.insertMany(reservations, { ordered: false });
  await TableDay.insertMany(tableDays, { ordered: false });
  await GuestDay.insertMany(guestDays, { ordered: false });
  expect(await Reservation.countDocuments({})).toBe(10_000);
}

// Seeding happens once; the per-test cleanup of useTestDatabase runs before `it`, so the
// whole measurement lives in a single test.
async function seed(): Promise<void> {
  await seedStaff();
  token = await loginAs(app);
  await Table.insertMany(
    Array.from({ length: 100 }, (_, i) => ({ name: `T${i + 1}`, nameKey: `t${i + 1}`, capacity: 4 })),
  );
  await ClosedDate.insertMany(dates("2027-01-01", 500).map((date) => ({ date, reason: null })));
  const put = await request(app).put("/schedule").set("Authorization", `Bearer ${token}`).send(SCHEDULE);
  expect(put.status).toBe(200);
  await seedReservations();
}

type Sample = { ms: number; status: number };

async function measure(send: (n: number) => request.Test, expectedStatus: number): Promise<number[]> {
  const samples: Sample[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const batch = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, i) => {
        const started = performance.now();
        const res = await send(round * CONCURRENCY + i).set("Authorization", `Bearer ${token}`);
        return { ms: performance.now() - started, status: res.status };
      }),
    );
    samples.push(...batch);
  }
  expect(samples.every((s) => s.status === expectedStatus)).toBe(true);
  return samples.map((s) => s.ms);
}

/** Nearest-rank 95th percentile. */
function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

const futureDates = dates("2030-01-01", ROUNDS * CONCURRENCY);

const OPERATIONS: [string, (n: number) => request.Test, number][] = [
  ["GET /tables", () => request(app).get("/tables"), 200],
  ["GET /schedule", () => request(app).get("/schedule"), 200],
  ["GET /closed-dates?includePast=true", () => request(app).get("/closed-dates?includePast=true"), 200],
  ["POST /tables", (n) => request(app).post("/tables").send({ name: `Perf ${n}`, capacity: 2 }), 201],
  ["PUT /schedule", () => request(app).put("/schedule").send(SCHEDULE), 200],
  ["POST /closed-dates", (n) => request(app).post("/closed-dates").send({ date: futureDates[n] }), 201],
  // Feature 002 public operations, against the full data volume. The lookups hit a fully
  // booked Saturday; the reservations go to days that still have free tables.
  [
    "GET /availability",
    () => request(app).get("/availability").query({ date: "2026-11-14", time: "20:30", partySize: "2" }),
    200,
  ],
  [
    "GET /availability/times",
    () => request(app).get("/availability/times").query({ date: "2026-11-14", partySize: "2" }),
    200,
  ],
  [
    "POST /reservations",
    (n) =>
      request(app)
        .post("/reservations")
        .send({
          date: FREE_DAYS[n % FREE_DAYS.length],
          time: "20:00",
          partySize: 2,
          name: "Perf Guest",
          email: `perf${n}@mail.com`,
          phone: "600123456",
        }),
    201,
  ],
];

describe("SC-006: performance smoke", () => {
  beforeAll(() => {
    expect(ROUNDS * CONCURRENCY).toBeGreaterThanOrEqual(100);
  });

  it(
    `p95 latency of every management and public operation is under ${P95_LIMIT_MS} ms`,
    async () => {
      await seed();
      for (const [name, send, status] of OPERATIONS) {
        const latency = p95(await measure(send, status));
        console.log(`${name}: p95 ${latency.toFixed(1)} ms`);
        expect.soft(latency, `${name} p95 (ms)`).toBeLessThan(P95_LIMIT_MS);
      }
    },
    120_000,
  );
});
