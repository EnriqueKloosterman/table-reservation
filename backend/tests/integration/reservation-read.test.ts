import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelAsStaff, cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { kept } from "../helpers/keep-alive.js";
import { loginAs } from "../helpers/login-as.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant, type SeededTable } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 004, US3: staff inspect one reservation by identifier (GET /reservations/{id}).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z"); // Monday
const DATE = "2026-11-14"; // Saturday
const SERVICE = [{ name: "Service", start: "17:00", end: "23:59" }];
const ITEM_KEYS = ["createdAt", "date", "endTime", "guest", "id", "partySize", "startTime", "status", "table"];

let app: Express;
let token = "";
let tables: SeededTable[] = [];

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seedStaff();
  tables = (
    await seedRestaurant({
      tables: Array.from({ length: 5 }, (_, i) => ({ name: `T${i + 1}`, capacity: 4 })),
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

let seq = 0;
async function create(time: string, partySize = 2): Promise<Created> {
  seq += 1;
  const res = await reserveAs(app, {
    date: DATE,
    time,
    partySize,
    name: `Read Guest ${seq}`,
    email: `read${seq}@mail.com`,
    phone: `+34 644 000 ${String(seq).padStart(3, "0")}`,
  });
  expect(res.status).toBe(201);
  return res.body as Created;
}

const read = (id: string, auth: string | null = token) => {
  const req = kept(app).get(`/reservations/${id}`);
  return auth === null ? req : req.set("Authorization", `Bearer ${auth}`);
};

/** Inserts a reservation directly on any date, to reach dates the booking rules would refuse. */
async function insertOn(date: string, status: "confirmed" | "cancelled" = "confirmed") {
  const start = new Date(`${date}T20:00:00Z`);
  return Reservation.create({
    status,
    ...(status === "cancelled" && { cancelledAt: NOW, cancelledBy: "staff" }),
    tableId: new Types.ObjectId(tables[0]!.id),
    date,
    startTime: "20:00",
    endTime: "22:00",
    startAt: start,
    endAt: new Date(start.getTime() + 2 * 3600_000),
    partySize: 2,
    guestName: "Direct Guest",
    guestEmail: "direct@mail.com",
    guestPhone: "+34 600 777 777",
    secretCodeHash: `hash-${new Types.ObjectId().toHexString()}`,
    createdAt: NOW,
  });
}

const withoutCode = (c: Created): Item => {
  const { secretCode: _secretCode, ...rest } = c;
  return rest;
};

describe("US3: read one reservation", () => {
  it("(a) a confirmed reservation: exactly the ReservationView keys, equal to its day-view item, no-store", async () => {
    const c = await create("20:00", 3);
    const res = await read(c.id);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body as object).sort()).toEqual(ITEM_KEYS);
    expect(res.body).toEqual(withoutCode(c));

    const day = await kept(app)
      .get(`/reservations?date=${DATE}&status=all`)
      .set("Authorization", `Bearer ${token}`);
    const fromDay = (day.body as { reservations: Item[] }).reservations.find((r) => r.id === c.id);
    expect(res.body).toEqual(fromDay);
  });

  it("(b) a cancelled reservation shows cancelledAt and cancelledBy, for guest and staff cancellations", async () => {
    const byGuest = await create("18:00");
    const byStaff = await create("19:00");
    expect((await cancelWithCode(app, byGuest.secretCode)).status).toBe(200);
    expect((await cancelAsStaff(app, byStaff.id, token)).status).toBe(200);

    const g = await read(byGuest.id);
    const s = await read(byStaff.id);
    expect(g.status).toBe(200);
    expect(s.status).toBe(200);
    expect(g.body).toEqual({ ...withoutCode(byGuest), status: "cancelled", cancelledAt: NOW.toISOString(), cancelledBy: "guest" });
    expect(s.body).toEqual({ ...withoutCode(byStaff), status: "cancelled", cancelledAt: NOW.toISOString(), cancelledBy: "staff" });
  });

  it.each([
    ["a past date", "2020-01-01"],
    ["a far-future date", "2099-12-31"],
  ])("(c) any date works: %s", async (_label, date) => {
    const doc = await insertOn(date);
    const res = await read(doc._id.toHexString());
    expect(res.status).toBe(200);
    expect((res.body as Item).date).toBe(date);
    expect((res.body as Item).table.name).toBe(tables[0]!.name);
  });

  it("(c) a reservation on a date that was closed afterwards is still readable", async () => {
    const c = await create("20:00");
    const closed = await kept(app)
      .post("/closed-dates")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: DATE });
    expect(closed.status).toBe(201);
    const res = await read(c.id);
    expect(res.status).toBe(200);
    expect((res.body as Item).id).toBe(c.id);
  });

  it("(d) SC-005: a removed table keeps its name; a renamed table shows the current name", async () => {
    const removed = await create("18:00");
    const renamed = await create("18:15");
    await Table.updateOne({ _id: tables.find((t) => t.name === removed.table.name)!.id }, { removed: true, removedAt: NOW });
    await Table.updateOne({ _id: tables.find((t) => t.name === renamed.table.name)!.id }, { name: "Terrace", nameKey: "terrace" });

    expect(((await read(removed.id)).body as Item).table.name).toBe(removed.table.name);
    expect(((await read(renamed.id)).body as Item).table.name).toBe("Terrace");
  });

  it("(d) a reservation whose table document is missing shows \"unknown\" and logs only the event and the id", async () => {
    const c = await create("20:00");
    await Table.deleteOne({ _id: tables.find((t) => t.name === c.table.name)!.id });
    const errorSpy = vi.mocked(console.error);
    errorSpy.mockClear();

    const res = await read(c.id);
    expect(res.status).toBe(200);
    expect((res.body as Item).table.name).toBe("unknown");
    const lines = errorSpy.mock.calls.map((call) => call.map(String).join(" "));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ event: "table_missing", reservationId: c.id });
  });

  it.each([
    ["an unknown well-formed id", "6741a0ffee0123456789abcd"],
    ["a short word", "abc"],
    ["23 hex characters", "6741a0ffee0123456789abc"],
    ["25 hex characters", "6741a0ffee0123456789abcde"],
    ["an encoded space", "%20"],
    ["24 characters with a non-hex one", "6741a0ffee0123456789abcg"],
    ["an unknown well-formed id in upper case", "6741A0FFEE0123456789ABCD"],
    ["the word cancel", "cancel"],
  ])("(e) %s is the standard 404 'Reservation not found', never 400 or 500", async (_label, id) => {
    await create("20:00");
    const error = expectError(await read(id), 404, "NOT_FOUND");
    expect(error.message).toBe("Reservation not found");
  });

  it("(f) SC-007: closed date -> affected id -> read -> staff cancel -> read shows cancelled by staff, also in the day view", async () => {
    const c = await create("20:00", 4);
    const closed = await kept(app)
      .post("/closed-dates")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: DATE, reason: "Private event" });
    expect(closed.status).toBe(201);
    const affected = (closed.body as { affectedReservations: { id: string }[] }).affectedReservations;
    expect(affected.map((a) => a.id)).toEqual([c.id]);

    const before = await read(affected[0]!.id);
    expect(before.status).toBe(200);
    expect((before.body as Item).status).toBe("confirmed");
    expect("cancelledAt" in (before.body as object)).toBe(false);

    expect((await cancelAsStaff(app, affected[0]!.id, token)).status).toBe(200);

    const after = (await read(affected[0]!.id)).body as Item;
    expect(after.status).toBe("cancelled");
    expect(after.cancelledBy).toBe("staff");
    expect(after.cancelledAt).toBe(NOW.toISOString());

    const day = await kept(app)
      .get(`/reservations?date=${DATE}&status=all`)
      .set("Authorization", `Bearer ${token}`);
    expect((day.body as { reservations: Item[] }).reservations.map((r) => r.id)).toContain(c.id);
  });

  it("(g) FR-009: an id from the day view is accepted by both this operation and the staff cancellation", async () => {
    await create("20:00");
    const day = await kept(app).get(`/reservations?date=${DATE}`).set("Authorization", `Bearer ${token}`);
    const id = (day.body as { reservations: Item[] }).reservations[0]!.id;
    expect((await read(id)).status).toBe(200);
    expect((await cancelAsStaff(app, id, token)).status).toBe(200);
  });
});
