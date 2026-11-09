import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { kept } from "../helpers/keep-alive.js";
import { loginAs } from "../helpers/login-as.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant, type SeededTable } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 004, US1: staff see the day's reservations (GET /reservations?date=).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z"); // Monday
const ZONE = "America/New_York"; // UTC-5 in November: 21:30 local is already the next UTC day
const DATE = "2026-11-14"; // Saturday
const BEFORE = "2026-11-13"; // Friday
const AFTER = "2026-11-15"; // Sunday
const SERVICE = [{ name: "Service", start: "17:00", end: "23:59" }];

let app: Express;
let token = "";
let tables: SeededTable[] = [];
let errorSpy: MockInstance<typeof console.error>;
let logSpy: MockInstance<typeof console.log>;

beforeEach(async () => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await seedStaff();
  const seeded = await seedRestaurant({
    tables: Array.from({ length: 12 }, (_, i) => ({ name: `T${i + 1}`, capacity: 4 })),
    schedule: { friday: SERVICE, saturday: SERVICE, sunday: SERVICE },
    closedDates: [{ date: "2026-11-20", reason: "Private event" }],
  });
  tables = seeded.tables;
  app = buildTestApp({ now: NOW, timeZone: ZONE, jwtExpiresIn: "30d" });
  token = await loginAs(app);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Created = {
  id: string;
  status: string;
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
  guest: { name: string; email: string; phone: string };
  table: { name: string };
  createdAt: string;
  secretCode: string;
};

type Item = Omit<Created, "secretCode">;

type DayBody = {
  date: string;
  status: string;
  summary: { reservations: number; guests: number; tablesUsed: number };
  reservations: Item[];
};

let seq = 0;

async function create(date: string, time: string, partySize: number): Promise<Created> {
  seq += 1;
  const res = await reserveAs(app, {
    date,
    time,
    partySize,
    name: `Guest ${seq}`,
    email: `guest${seq}@mail.com`,
    phone: `+34 600 000 ${String(seq).padStart(3, "0")}`,
  });
  expect(res.status).toBe(201);
  return res.body as Created;
}

/** What the day view must show for a creation answer: the same item without the secret code. */
function expectedItem(c: Created): Item {
  return {
    id: c.id,
    status: c.status,
    date: c.date,
    startTime: c.startTime,
    endTime: c.endTime,
    partySize: c.partySize,
    guest: c.guest,
    table: c.table,
    createdAt: c.createdAt,
  };
}

const getDay = (query: string, auth: string | undefined = token) => {
  const req = kept(app).get(`/reservations${query}`);
  return auth === undefined ? req : req.set("Authorization", `Bearer ${auth}`);
};

/** Inserts a confirmed reservation directly, to control the table and the start instant. */
async function insertAt(tableId: string, startAtUtc: string, date: string, startTime: string, endTime: string) {
  const start = new Date(startAtUtc);
  return Reservation.create({
    status: "confirmed",
    tableId: new Types.ObjectId(tableId),
    date,
    startTime,
    endTime,
    startAt: start,
    endAt: new Date(start.getTime() + 2 * 3600_000),
    partySize: 2,
    guestName: `Direct ${seq++}`,
    guestEmail: `direct${seq}@mail.com`,
    guestPhone: "+34 600 999 999",
    secretCodeHash: `hash-${seq}-${new Types.ObjectId().toHexString()}`,
    createdAt: NOW,
  });
}

const tableNamed = (name: string): SeededTable => {
  const t = tables.find((x) => x.name === name);
  if (!t) throw new Error(`no table ${name}`);
  return t;
};

describe("US1: the day view", () => {
  it("SC-001: shows exactly the date's reservations in start-time order with every field (not the neighbouring days')", async () => {
    // Created out of time order on purpose, so id order differs from start-time order.
    const times = ["19:15", "18:00", "20:15", "18:45", "19:45", "18:15", "19:00", "18:30", "20:00", "19:30", "21:30"];
    const sizes = [2, 4, 3, 1, 4, 2, 3, 2, 4, 1, 3];
    const onDate: Created[] = [];
    for (const [i, time] of times.entries()) onDate.push(await create(DATE, time, sizes[i]!));
    await create(BEFORE, "21:30", 2); // UTC date is the 14th
    await create(AFTER, "18:00", 2);

    const res = await getDay(`?date=${DATE}`);
    expect(res.status).toBe(200);
    const body = res.body as DayBody;

    const expected = [...onDate].sort((a, b) => a.startTime.localeCompare(b.startTime)).map(expectedItem);
    expect(body.reservations).toHaveLength(11);
    expect(body.reservations).toEqual(expected);
    for (const item of body.reservations) {
      expect(item.status).toBe("confirmed");
      expect(item.date).toBe(DATE);
      expect(item.createdAt).toBe("2026-11-09T10:00:00.000Z");
      expect("cancelledAt" in item).toBe(false);
      expect("cancelledBy" in item).toBe(false);
      expect(JSON.stringify(item)).not.toMatch(/secretCode|startAt|tableId/);
    }
    // The 21:30 reservation is local-date 14th although its UTC instant is the 15th.
    expect(body.reservations.at(-1)?.startTime).toBe("21:30");
  });

  it("SC-002: the summary matches independently computed figures; several reservations on one table count as one", async () => {
    const created = [
      await create(DATE, "18:00", 2),
      await create(DATE, "18:15", 4),
      await create(DATE, "18:30", 3),
    ];
    // Same table as the 18:00 one once it is free again (it ends at 20:00).
    const again = await create(DATE, "20:15", 1);
    expect(again.table.name).toBe(created[0]!.table.name);
    const all = [...created, again];

    const body = (await getDay(`?date=${DATE}`)).body as DayBody;
    expect(body.summary).toEqual({
      reservations: all.length,
      guests: all.reduce((sum, c) => sum + c.partySize, 0),
      tablesUsed: new Set(all.map((c) => c.table.name)).size,
    });
    expect(body.summary.tablesUsed).toBe(3);
    expect(body.summary.reservations).toBe(4);
  });

  it.each([
    ["an empty date", "2026-11-16"],
    ["a past date", "2020-01-01"],
    ["a far-future date", "2099-12-31"],
    ["a closed date with no reservations", "2026-11-20"],
    ["a non-service day with no reservations", "2026-11-17"],
  ])("SC-006: %s answers 200 with an empty list and a zero summary", async (_label, date) => {
    await create(DATE, "20:00", 2); // other data exists
    const res = await getDay(`?date=${date}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date,
      status: "confirmed",
      summary: { reservations: 0, guests: 0, tablesUsed: 0 },
      reservations: [],
    });
  });

  it("US1.6: same start time on T2 and T10 shows T2 first, and ten repeated requests give the identical order", async () => {
    const day = "2026-11-28"; // Saturday, not covered by the other tests
    const t10 = tableNamed("T10");
    const t2 = tableNamed("T2");
    // T10 is inserted first, so its id is lower: only the table-name rule can put T2 first.
    const first = await insertAt(t10.id, "2026-11-29T01:00:00Z", day, "20:00", "22:00");
    const second = await insertAt(t2.id, "2026-11-29T01:00:00Z", day, "20:00", "22:00");
    expect(first._id.toHexString() < second._id.toHexString()).toBe(true);

    const orders: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const body = (await getDay(`?date=${day}`)).body as DayBody;
      orders.push(body.reservations.map((r) => r.table.name).join(","));
    }
    expect(orders[0]).toBe("T2,T10");
    expect(new Set(orders).size).toBe(1);
  });

  it("answers with no-store, exactly the four keys, and status confirmed when omitted", async () => {
    await create(DATE, "20:00", 2);
    const res = await getDay(`?date=${DATE}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body as object).sort()).toEqual(["date", "reservations", "status", "summary"]);
    expect((res.body as DayBody).status).toBe("confirmed");
    expect((res.body as DayBody).date).toBe(DATE);
  });

  it("SC-005: a renamed table shows the new name; a removed table still shows its name", async () => {
    const renamed = await create(DATE, "18:00", 2);
    const removed = await create(DATE, "18:15", 2);
    const renamedTable = tables.find((t) => t.name === renamed.table.name)!;
    const removedTable = tables.find((t) => t.name === removed.table.name)!;
    await Table.updateOne({ _id: renamedTable.id }, { name: "Terrace", nameKey: "terrace" });
    await Table.updateOne({ _id: removedTable.id }, { removed: true, removedAt: NOW });

    const body = (await getDay(`?date=${DATE}`)).body as DayBody;
    const byId = new Map(body.reservations.map((r) => [r.id, r]));
    expect(byId.get(renamed.id)?.table.name).toBe("Terrace");
    expect(byId.get(removed.id)?.table.name).toBe(removed.table.name);
  });

  it("shows \"unknown\" for a missing table document and logs one table_missing line with only the event and the id", async () => {
    const created = await create(DATE, "20:00", 2);
    const table = tables.find((t) => t.name === created.table.name)!;
    await Table.deleteOne({ _id: table.id });
    errorSpy.mockClear();

    const res = await getDay(`?date=${DATE}`);
    expect(res.status).toBe(200);
    expect((res.body as DayBody).reservations[0]?.table.name).toBe("unknown");

    const lines = errorSpy.mock.calls.map((call) => call.map(String).join(" "));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ event: "table_missing", reservationId: created.id });
    const everything = [...lines, ...logSpy.mock.calls.map((call) => call.map(String).join(" "))].join("\n");
    for (const personal of [created.guest.name, created.guest.email, created.guest.phone]) {
      expect(everything).not.toContain(personal);
    }
  });
});
