import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelAsStaff, cancelWithCode } from "../helpers/cancel-as.js";
import { kept } from "../helpers/keep-alive.js";
import { loginAs } from "../helpers/login-as.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant, type SeededTable } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 004, US2: staff include or isolate cancelled reservations (status=confirmed|all|cancelled).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z"); // Monday
const DATE = "2026-11-14"; // Saturday
const SERVICE = [{ name: "Service", start: "17:00", end: "23:59" }];

let app: Express;
let token = "";
let tables: SeededTable[] = [];

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seedStaff();
  tables = (
    await seedRestaurant({
      tables: Array.from({ length: 6 }, (_, i) => ({ name: `T${i + 1}`, capacity: 4 })),
      schedule: { saturday: SERVICE },
    })
  ).tables;
  app = buildTestApp({ now: NOW, jwtExpiresIn: "30d" });
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
type Item = Omit<Created, "secretCode"> & { cancelledAt?: string; cancelledBy?: string };
type DayBody = {
  date: string;
  status: string;
  summary: { reservations: number; guests: number; tablesUsed: number };
  reservations: Item[];
};

let seq = 0;
async function create(time: string, partySize: number, date = DATE): Promise<Created> {
  seq += 1;
  const res = await reserveAs(app, {
    date,
    time,
    partySize,
    name: `Status Guest ${seq}`,
    email: `status${seq}@mail.com`,
    phone: `+34 633 000 ${String(seq).padStart(3, "0")}`,
  });
  expect(res.status).toBe(201);
  return res.body as Created;
}

const getDay = (query: string) => kept(app).get(`/reservations?${query}`).set("Authorization", `Bearer ${token}`);
const day = async (query: string) => {
  const res = await getDay(query);
  expect(res.status).toBe(200);
  return res.body as DayBody;
};
const ids = (body: DayBody) => body.reservations.map((r) => r.id);

/**
 * 18:00 confirmed, 18:30 cancelled by the guest, 19:00 confirmed, 19:30 cancelled by staff,
 * 20:00 confirmed.
 */
async function scenario() {
  const confirmedA = await create("18:00", 2);
  const byGuest = await create("18:30", 4);
  const confirmedB = await create("19:00", 3);
  const byStaff = await create("19:30", 1);
  const confirmedC = await create("20:00", 2);
  expect((await cancelWithCode(app, byGuest.secretCode)).status).toBe(200);
  expect((await cancelAsStaff(app, byStaff.id, token)).status).toBe(200);
  return { confirmedA, byGuest, confirmedB, byStaff, confirmedC };
}

describe("US2: the status choices", () => {
  it("(a) no status and status=confirmed list only the confirmed reservations and echo confirmed", async () => {
    const s = await scenario();
    const expected = [s.confirmedA.id, s.confirmedB.id, s.confirmedC.id];
    for (const query of [`date=${DATE}`, `date=${DATE}&status=confirmed`]) {
      const body = await day(query);
      expect(body.status).toBe("confirmed");
      expect(ids(body)).toEqual(expected);
    }
  });

  it("(b) status=all lists both kinds in one start-time order and echoes all", async () => {
    const s = await scenario();
    const body = await day(`date=${DATE}&status=all`);
    expect(body.status).toBe("all");
    expect(ids(body)).toEqual([s.confirmedA, s.byGuest, s.confirmedB, s.byStaff, s.confirmedC].map((c) => c.id));
    expect(body.reservations.map((r) => r.status)).toEqual([
      "confirmed",
      "cancelled",
      "confirmed",
      "cancelled",
      "confirmed",
    ]);
  });

  it("(c) status=cancelled lists only the cancelled reservations and echoes cancelled", async () => {
    const s = await scenario();
    const body = await day(`date=${DATE}&status=cancelled`);
    expect(body.status).toBe("cancelled");
    expect(ids(body)).toEqual([s.byGuest.id, s.byStaff.id]);
    expect(body.reservations.every((r) => r.status === "cancelled")).toBe(true);
  });

  it("(d) SC-002: the summary is deeply equal under all three choices and counts confirmed only", async () => {
    const s = await scenario();
    const confirmed = [s.confirmedA, s.confirmedB, s.confirmedC];
    const expected = {
      reservations: 3,
      guests: confirmed.reduce((sum, c) => sum + c.partySize, 0),
      tablesUsed: new Set(confirmed.map((c) => c.table.name)).size,
    };
    for (const query of [`date=${DATE}`, `date=${DATE}&status=confirmed`, `date=${DATE}&status=all`, `date=${DATE}&status=cancelled`]) {
      expect((await day(query)).summary, query).toEqual(expected);
    }
  });

  it("(e) each cancelled item has cancelledAt (the clock's instant) and the right cancelledBy; confirmed items have neither key", async () => {
    const s = await scenario();
    const byId = new Map((await day(`date=${DATE}&status=all`)).reservations.map((r) => [r.id, r]));
    expect(byId.get(s.byGuest.id)).toMatchObject({ cancelledAt: NOW.toISOString(), cancelledBy: "guest" });
    expect(byId.get(s.byStaff.id)).toMatchObject({ cancelledAt: NOW.toISOString(), cancelledBy: "staff" });
    for (const c of [s.confirmedA, s.confirmedB, s.confirmedC]) {
      const item = byId.get(c.id)!;
      expect("cancelledAt" in item).toBe(false);
      expect("cancelledBy" in item).toBe(false);
    }
  });

  it("(f) a day with only cancelled reservations: default is empty with zeros, cancelled and all show them", async () => {
    const other = "2026-11-21"; // Saturday, no service schedule problem: same weekly schedule
    const only = await create("20:00", 2, other);
    expect((await cancelWithCode(app, only.secretCode)).status).toBe(200);

    const zero = { reservations: 0, guests: 0, tablesUsed: 0 };
    const dflt = await day(`date=${other}`);
    expect(dflt.reservations).toEqual([]);
    expect(dflt.summary).toEqual(zero);
    for (const status of ["cancelled", "all"]) {
      const body = await day(`date=${other}&status=${status}`);
      expect(ids(body), status).toEqual([only.id]);
      expect(body.summary, status).toEqual(zero);
    }
  });

  it("(g) a reservation cancelled between two requests changes the lists and the summary consistently", async () => {
    const s = await scenario();
    const before = await day(`date=${DATE}&status=all`);
    expect(before.summary.reservations).toBe(3);
    expect(before.reservations.filter((r) => r.status === "confirmed")).toHaveLength(3);

    expect((await cancelAsStaff(app, s.confirmedB.id, token)).status).toBe(200);

    const all = await day(`date=${DATE}&status=all`);
    const confirmed = await day(`date=${DATE}`);
    const cancelled = await day(`date=${DATE}&status=cancelled`);
    expect(all.summary).toEqual(confirmed.summary);
    expect(all.summary.reservations).toBe(2);
    expect(all.summary.guests).toBe(s.confirmedA.partySize + s.confirmedC.partySize);
    expect(ids(all)).toHaveLength(5);
    // Each answer's list and summary agree.
    expect(confirmed.reservations).toHaveLength(confirmed.summary.reservations);
    expect(all.reservations.filter((r) => r.status === "confirmed")).toHaveLength(all.summary.reservations);
    expect(ids(cancelled)).toEqual([s.byGuest.id, s.confirmedB.id, s.byStaff.id]);
    expect(ids(confirmed)).toEqual([s.confirmedA.id, s.confirmedC.id]);
  });

  it("(h) a cancelled reservation whose table was later removed still shows its table name", async () => {
    const s = await scenario();
    const table = tables.find((t) => t.name === s.byGuest.table.name)!;
    await Table.updateOne({ _id: table.id }, { removed: true, removedAt: NOW });
    const item = (await day(`date=${DATE}&status=cancelled`)).reservations.find((r) => r.id === s.byGuest.id);
    expect(item?.table.name).toBe(s.byGuest.table.name);
  });

  it("(i) a cancelled reservation still shows the guest's name, email and phone", async () => {
    const s = await scenario();
    const item = (await day(`date=${DATE}&status=cancelled`)).reservations.find((r) => r.id === s.byStaff.id);
    expect(item?.guest).toEqual(s.byStaff.guest);
  });

  it("(j) cancelled documents lacking cancelledAt / cancelledBy are listed without those keys instead of failing", async () => {
    const date = "2026-11-28";
    const start = new Date("2026-11-28T20:00:00Z");
    const raw = {
      _id: new Types.ObjectId(),
      status: "cancelled",
      tableId: new Types.ObjectId(tables[0]!.id),
      date,
      startTime: "20:00",
      endTime: "22:00",
      startAt: start,
      endAt: new Date(start.getTime() + 2 * 3600_000),
      partySize: 2,
      guestName: "Legacy Guest",
      guestEmail: "legacy@mail.com",
      guestPhone: "+34 600 555 555",
      secretCodeHash: `hash-${new Types.ObjectId().toHexString()}`,
      createdAt: NOW,
    };
    await Reservation.collection.insertOne(raw);

    const res = await getDay(`date=${date}&status=all`);
    expect(res.status).toBe(200);
    const item = (res.body as DayBody).reservations[0]!;
    expect(item.id).toBe(raw._id.toHexString());
    expect(item.status).toBe("cancelled");
    expect("cancelledAt" in item).toBe(false);
    expect("cancelledBy" in item).toBe(false);
  });
});
