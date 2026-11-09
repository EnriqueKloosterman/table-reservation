import mongoose, { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { kept } from "../helpers/keep-alive.js";
import { loginAs } from "../helpers/login-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 004, SC-010: the day view of a busy day (200 reservations) and the single read answer
// well under 1 s (p95) among 10,000 other reservations, under the 002 load profile (10 concurrent
// clients, 100 tables, 500 closed dates).
const P95_LIMIT_MS = 1000;
const ROUNDS = 10;
const CONCURRENCY = 10;
const TABLES = 100;
const BUSY_DAY = "2026-11-14";

useTestDatabase();

const app = buildTestApp({ now: new Date("2026-11-06T12:00:00Z") });
let token = "";

/** `count` consecutive calendar dates from `start` (UTC arithmetic on a date-only value). */
function dates(start: string, count: number): string[] {
  const first = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => new Date(first + i * 86_400_000).toISOString().slice(0, 10));
}

/** Deterministic shuffle (LCG), so the inserted order is not the date or start-time order. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  let seed = 12345;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

type Doc = Record<string, unknown>;

function reservation(tableId: Types.ObjectId, date: string, start: string, end: string, n: number, over: Doc = {}): Doc {
  const startAt = new Date(`${date}T${start}:00Z`);
  return {
    _id: new Types.ObjectId(),
    status: "confirmed",
    tableId,
    date,
    startTime: start,
    endTime: end,
    startAt,
    endAt: new Date(`${date}T${end}:00Z`),
    partySize: 2 + (n % 3),
    guestName: `Seed Guest ${n}`,
    guestEmail: `seed${n}@mail.com`,
    guestPhone: "600123456",
    secretCodeHash: new Types.ObjectId().toHexString().padStart(64, "0"),
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...over,
  };
}

type Expected = { confirmed: number; cancelled: number; guests: number; tablesUsed: number; ids: string[] };

/** 10,000 background reservations on 100 other dates plus the busy day (lunch and dinner per table). */
async function seed(): Promise<Expected> {
  await seedStaff();
  await seedRestaurant({
    schedule: { saturday: [{ name: "Dinner", start: "20:00", end: "23:30" }] },
  });
  token = await loginAs(app);
  await Table.insertMany(
    Array.from({ length: TABLES }, (_, i) => ({ name: `T${i + 1}`, nameKey: `t${i + 1}`, capacity: 4 })),
  );
  await ClosedDate.insertMany(dates("2027-01-01", 500).map((date) => ({ date, reason: null })));
  const tables = await Table.find({}, { _id: 1 }).lean();

  const docs: Doc[] = [];
  let n = 0;
  for (const date of dates("2026-12-01", 100)) {
    for (const table of tables) docs.push(reservation(table._id, date, "20:00", "22:00", n++));
  }

  const busy: Doc[] = [];
  tables.forEach((table, t) => {
    busy.push(reservation(table._id, BUSY_DAY, "12:00", "14:00", n++));
    // Dinner: every other table's reservation is cancelled.
    busy.push(
      reservation(
        table._id,
        BUSY_DAY,
        "20:00",
        "22:00",
        n++,
        t % 2 === 0 ? { status: "cancelled", cancelledAt: new Date("2026-11-05T10:00:00Z"), cancelledBy: t % 4 === 0 ? "guest" : "staff" } : {},
      ),
    );
  });
  docs.push(...busy);
  expect(docs).toHaveLength(10_200);

  await Reservation.insertMany(shuffled(docs), { ordered: false });
  expect(await Reservation.countDocuments({})).toBe(10_200);

  const confirmed = busy.filter((d) => d["status"] === "confirmed");
  return {
    confirmed: confirmed.length,
    cancelled: busy.length - confirmed.length,
    guests: confirmed.reduce((sum, d) => sum + (d["partySize"] as number), 0),
    tablesUsed: new Set(confirmed.map((d) => String(d["tableId"]))).size,
    ids: busy.map((d) => (d["_id"] as Types.ObjectId).toHexString()),
  };
}

type Response = { status: number; body: unknown; ms: number };

async function measure(send: (n: number) => Promise<{ status: number; body: unknown }>): Promise<Response[]> {
  const samples: Response[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const batch = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, i) => {
        const started = performance.now();
        const res = await send(round * CONCURRENCY + i);
        return { status: res.status, body: res.body, ms: performance.now() - started };
      }),
    );
    samples.push(...batch);
  }
  return samples;
}

/** Nearest-rank 95th percentile. */
function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

/**
 * Timing alone cannot see a lost index at this volume (the database scans 10,000 small documents
 * in a few milliseconds), so the filter the service really sends is captured and its plan checked.
 */
async function dayQueryPlan(): Promise<{ stages: string; examined: number; returned: number }> {
  const seen: Record<string, unknown>[] = [];
  mongoose.set("debug", (collection: string, method: string, ...args: unknown[]) => {
    if (collection === "reservations" && method === "find") seen.push(args[0] as Record<string, unknown>);
  });
  try {
    const res = await kept(app).get(`/reservations?date=${BUSY_DAY}&status=all`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  } finally {
    mongoose.set("debug", false);
  }
  expect(seen).toHaveLength(1); // ONE read of the day's reservations
  const explain = (await Reservation.collection.find(seen[0]!).explain("executionStats")) as {
    queryPlanner: { winningPlan: unknown };
    executionStats: { totalDocsExamined: number; nReturned: number };
  };
  return {
    stages: JSON.stringify(explain.queryPlanner.winningPlan),
    examined: explain.executionStats.totalDocsExamined,
    returned: explain.executionStats.nReturned,
  };
}

type Day = {
  date: string;
  status: string;
  summary: { reservations: number; guests: number; tablesUsed: number };
  reservations: { id: string; status: string; startTime: string; table: { name: string } }[];
};

describe("SC-010: the day view and the single read under load", () => {
  it(
    `p95 latency of a busy day (200 reservations among 10,000) and of the single read is under ${P95_LIMIT_MS} ms`,
    async () => {
      const expected = await seed();
      const auth = { Authorization: `Bearer ${token}` };

      const list = await measure((n) => {
        void n;
        return kept(app).get(`/reservations?date=${BUSY_DAY}&status=all`).set(auth);
      });
      const listP95 = p95(list.map((s) => s.ms));
      console.log(`GET /reservations?date=<busy day>&status=all: p95 ${listP95.toFixed(1)} ms`);
      expect(list.every((s) => s.status === 200)).toBe(true);
      expect.soft(listP95, "day view p95 (ms)").toBeLessThan(P95_LIMIT_MS);

      // The busy day answers with the right content, not just quickly.
      const body = list[0]!.body as Day;
      expect(body.date).toBe(BUSY_DAY);
      expect(body.status).toBe("all");
      expect(body.reservations).toHaveLength(expected.confirmed + expected.cancelled);
      expect(body.reservations.filter((r) => r.status === "cancelled")).toHaveLength(expected.cancelled);
      expect(body.summary).toEqual({
        reservations: expected.confirmed,
        guests: expected.guests,
        tablesUsed: expected.tablesUsed,
      });
      const starts = body.reservations.map((r) => r.startTime);
      expect(starts).toEqual([...starts].sort());
      expect(new Set(body.reservations.map((r) => r.id))).toEqual(new Set(expected.ids));

      // The day is found through the { date: 1 } index: only that day's documents are examined.
      const plan = await dayQueryPlan();
      expect(plan.stages).toContain("IXSCAN");
      expect(plan.stages).not.toContain("COLLSCAN");
      expect(plan.returned).toBe(expected.confirmed + expected.cancelled);
      expect(plan.examined).toBe(plan.returned);

      const single = await measure((n) =>
        kept(app).get(`/reservations/${expected.ids[(n * 7) % expected.ids.length]}`).set(auth),
      );
      const singleP95 = p95(single.map((s) => s.ms));
      console.log(`GET /reservations/{id}: p95 ${singleP95.toFixed(1)} ms`);
      expect(single.every((s) => s.status === 200)).toBe(true);
      expect.soft(singleP95, "single read p95 (ms)").toBeLessThan(P95_LIMIT_MS);
    },
    180_000,
  );
});
