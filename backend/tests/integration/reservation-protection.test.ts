import { Types } from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
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

// A movable "now": Monday 2026-11-09 10:00 UTC at the start of every test.
const START = new Date("2026-11-09T10:00:00Z");
let current = START;
const app = buildTestApp({ now: () => new Date(current.getTime()), jwtExpiresIn: "30d" });
let token = "";
let tables: SeededTable[] = [];

const THURSDAY = "2026-12-24";
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

beforeEach(async () => {
  current = START;
  await seedStaff();
  token = await loginAs(app);
  const seeded = await seedRestaurant({
    tables: [{ name: "T5", capacity: 6 }],
    schedule: { thursday: [DINNER], saturday: [DINNER], monday: [DINNER] },
  });
  tables = seeded.tables;
});

const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
const removeTable = (id: string) => auth(kept(app).delete(`/tables/${id}`));
const patchTable = (id: string, body: unknown) => auth(kept(app).patch(`/tables/${id}`)).send(body as object);
const addClosed = (date: string) => auth(kept(app).post("/closed-dates")).send({ date });
const putSchedule = (days: unknown) => auth(kept(app).put("/schedule")).send({ days });

type Affected = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
  guestName: string;
  tableName: string;
  status: "confirmed";
};

const reserve = (over: Record<string, unknown> = {}) => reserveAs(app, over);
const idOf = (res: request.Response) => (res.body as { id: string }).id;
const tableOf = (name: string) => tables.find((t) => t.name === name)!;

async function holdFor(tableId: string, date: string, start: Date, end: Date) {
  await TableDay.updateOne(
    { tableId: new Types.ObjectId(tableId), date },
    { $push: { intervals: { reservationId: new Types.ObjectId(), start, end } } },
    { upsert: true },
  );
}

describe("DELETE /tables/{id}: protection (FR-017, FR-018)", () => {
  it("US4 #1: refuses removal while a reservation has not ended, leaving the table untouched", async () => {
    const created = await reserve({ date: "2026-11-14", time: "20:00", partySize: 4 });
    expect(created.status).toBe(201);

    const res = await removeTable(tableOf("T5").id);
    const error = expectError(res, 409, "CONFLICT");
    expect(error.details).toEqual({ reason: "table_has_upcoming_reservations" });

    const table = await Table.findById(tableOf("T5").id).lean();
    expect(table!.removed).toBe(false);
    expect(table!.removedAt).toBeNull();
    expect(await Reservation.countDocuments({})).toBe(1);
    // and the table is still offered
    expect((await kept(app).get("/tables/" + tableOf("T5").id).set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("US4 #2: removal is allowed once every reservation has ended, and past reservations keep the table", async () => {
    const created = await reserve({ date: "2026-11-14", time: "20:00", partySize: 4 });
    expect(created.status).toBe(201);
    current = new Date("2026-11-14T22:30:00Z"); // exactly the end of the reservation

    expect((await removeTable(tableOf("T5").id)).status).toBe(204);

    const table = await Table.findById(tableOf("T5").id).lean();
    expect(table!.removed).toBe(true);
    const stored = await Reservation.findById(idOf(created)).lean();
    expect(stored!.tableId.toHexString()).toBe(tableOf("T5").id);
    expect(table!.name).toBe("T5"); // the reservation still shows the table name
  });

  it("an interval ending exactly now does not block; one ending a millisecond later does", async () => {
    const t = tableOf("T5");
    await holdFor(t.id, "2026-11-09", new Date("2026-11-09T08:00:00Z"), new Date(START.getTime()));
    // a second table to test the other side of the boundary
    const other = (await seedRestaurant({ tables: [{ name: "T9", capacity: 2 }] })).tables[0]!;
    await holdFor(other.id, "2026-11-09", new Date("2026-11-09T08:00:00Z"), new Date(START.getTime() + 1));

    expect((await removeTable(t.id)).status).toBe(204);
    expectError(await removeTable(other.id), 409, "CONFLICT");
  });

  it("an orphan interval (no reservation) also blocks removal", async () => {
    await holdFor(tableOf("T5").id, "2026-11-14", new Date("2026-11-14T20:00:00Z"), new Date("2026-11-14T22:00:00Z"));
    expect(await Reservation.countDocuments({})).toBe(0);
    const error = expectError(await removeTable(tableOf("T5").id), 409, "CONFLICT");
    expect(error.details).toEqual({ reason: "table_has_upcoming_reservations" });
  });

  it("a table with a past interval only can be removed", async () => {
    await holdFor(tableOf("T5").id, "2026-11-01", new Date("2026-11-01T20:00:00Z"), new Date("2026-11-01T22:00:00Z"));
    expect((await removeTable(tableOf("T5").id)).status).toBe(204);
  });

  it("a removed table is never considered by availability or by a reservation", async () => {
    expect((await removeTable(tableOf("T5").id)).status).toBe(204);
    const availability = await kept(app)
      .get("/availability")
      .query({ date: "2026-11-14", time: "20:00", partySize: "2" });
    expect(availability.body).toMatchObject({ available: false, reason: "party_too_large" });
    const error = expectError(await reserve({ date: "2026-11-14", time: "20:00", partySize: 2 }), 409, "NO_AVAILABILITY");
    expect(error.details).toEqual({ reason: "party_too_large" });
  });

  it("still answers 404 for an unknown or already removed table, and 401 without a token", async () => {
    expect((await removeTable(tableOf("T5").id)).status).toBe(204);
    expectError(await removeTable(tableOf("T5").id), 404, "NOT_FOUND");
    expectError(await removeTable("0123456789abcdef01234567"), 404, "NOT_FOUND");
    expectError(await kept(app).delete(`/tables/${tableOf("T5").id}`), 401, "AUTHENTICATION_REQUIRED");
  });

  it("a refused removal keeps the table active, so its name stays taken", async () => {
    await reserve({ date: "2026-11-14", time: "20:00", partySize: 4 });
    expectError(await removeTable(tableOf("T5").id), 409, "CONFLICT");
    expectError(await auth(kept(app).post("/tables")).send({ name: "t5", capacity: 2 }), 409, "CONFLICT");
  });
});

describe("configuration changes never modify reservations (FR-020)", () => {
  async function snapshot() {
    return JSON.stringify({
      reservations: await Reservation.find({}).sort({ _id: 1 }).select("+secretCodeHash").lean(),
      tableDays: await TableDay.find({}).sort({ _id: 1 }).lean(),
      guestDays: await GuestDay.find({}).sort({ _id: 1 }).lean(),
    });
  }

  it("closed date, schedule replacement and capacity edit leave every document unchanged", async () => {
    expect((await reserve({ date: THURSDAY, time: "20:00", partySize: 6 })).status).toBe(201);
    const before = await snapshot();

    expect((await addClosed(THURSDAY)).status).toBe(201);
    expect((await putSchedule([{ day: "thursday", periods: [{ name: "Lunch", start: "12:00", end: "15:00" }] }])).status).toBe(200);
    expect((await patchTable(tableOf("T5").id, { capacity: 4 })).status).toBe(200);

    expect(await snapshot()).toBe(before);
    expect(await Reservation.countDocuments({ status: "confirmed" })).toBe(1);
  });

  it("after a closed date, availability reports closed_date while the reservation stays confirmed", async () => {
    const created = await reserve({ date: THURSDAY, time: "20:00", partySize: 6 });
    await addClosed(THURSDAY);
    const res = await kept(app).get("/availability").query({ date: THURSDAY, time: "20:00", partySize: "6" });
    expect(res.body).toMatchObject({ available: false, reason: "closed_date" });
    const stored = await Reservation.findById(idOf(created)).lean();
    expect(stored).toMatchObject({ status: "confirmed", date: THURSDAY, partySize: 6 });
    expect(stored!.tableId.toHexString()).toBe(tableOf("T5").id);
  });
});

describe("affectedReservations (FR-022)", () => {
  async function bookGuest() {
    const created = await reserve({
      date: THURSDAY,
      time: "20:00",
      partySize: 6,
      name: "Ana García",
      email: "ana@mail.com",
    });
    expect(created.status).toBe(201);
    return idOf(created);
  }

  const expected = (id: string): Affected => ({
    id,
    date: THURSDAY,
    startTime: "20:00",
    endTime: "22:00",
    partySize: 6,
    guestName: "Ana García",
    tableName: "T5",
    status: "confirmed",
  });

  it("a closed date on 2026-12-24 lists the 6-guest reservation at T5", async () => {
    const id = await bookGuest();
    const res = await addClosed(THURSDAY);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ date: THURSDAY, reason: null, affectedReservations: [expected(id)] });
  });

  it("a schedule replacement leaving it outside service hours lists it", async () => {
    const id = await bookGuest();
    const res = await putSchedule([{ day: "thursday", periods: [{ name: "Lunch", start: "12:00", end: "15:00" }] }]);
    expect(res.status).toBe(200);
    expect((res.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([expected(id)]);
  });

  it("a schedule that closes the weekday lists it; one that still contains it does not", async () => {
    const id = await bookGuest();
    const closed = await putSchedule([{ day: "friday", periods: [DINNER] }]);
    expect((closed.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([expected(id)]);
    const wider = await putSchedule([{ day: "thursday", periods: [{ name: "Evening", start: "19:00", end: "23:59" }] }]);
    expect((wider.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
    const same = await putSchedule([{ day: "thursday", periods: [{ name: "Dinner", start: "20:00", end: "22:00" }] }]);
    expect((same.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
  });

  it("reducing T5 to capacity 4 lists it; keeping capacity ≥ party does not", async () => {
    const id = await bookGuest();
    const same = await patchTable(tableOf("T5").id, { capacity: 6 });
    expect((same.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
    const bigger = await patchTable(tableOf("T5").id, { capacity: 10 });
    expect((bigger.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
    const reduced = await patchTable(tableOf("T5").id, { capacity: 4 });
    expect(reduced.status).toBe(200);
    expect(reduced.body).toEqual({
      id: tableOf("T5").id,
      name: "T5",
      capacity: 4,
      affectedReservations: [expected(id)],
    });
  });

  it("changes touching nothing return an empty list", async () => {
    await bookGuest();
    const closed = await addClosed("2026-12-31");
    expect((closed.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
    const schedule = await putSchedule([{ day: "thursday", periods: [DINNER] }]);
    expect((schedule.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
  });

  it("a rename never affects reservations, and capacity absent from the body gives []", async () => {
    await bookGuest();
    const renamed = await patchTable(tableOf("T5").id, { name: "Window" });
    expect((renamed.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([]);
    const both = await patchTable(tableOf("T5").id, { name: "Corner", capacity: 4 });
    const list = (both.body as { affectedReservations: Affected[] }).affectedReservations;
    expect(list).toHaveLength(1);
    expect(list[0]!.tableName).toBe("Corner"); // the report shows the name after the change
  });

  it("is ordered by start instant, then by id, and lists only reservations that have not ended", async () => {
    await seedRestaurant({
      tables: [{ name: "T6", capacity: 6 }, { name: "T7", capacity: 6 }, { name: "T8", capacity: 6 }],
    });
    const ids: Record<string, string> = {};
    // two at the same start (tie → id order), one later, one earlier
    ids.late = idOf(await reserve({ date: THURSDAY, time: "21:00", partySize: 6, email: "late@mail.com" }));
    ids.early = idOf(await reserve({ date: THURSDAY, time: "18:00", partySize: 6, email: "early@mail.com" }));
    ids.tieA = idOf(await reserve({ date: THURSDAY, time: "19:30", partySize: 6, email: "a@mail.com" }));
    ids.tieB = idOf(await reserve({ date: THURSDAY, time: "19:30", partySize: 6, email: "b@mail.com" }));

    const res = await addClosed(THURSDAY);
    const list = (res.body as { affectedReservations: Affected[] }).affectedReservations;
    const tie = [ids.tieA, ids.tieB].sort();
    expect(list.map((a) => a.id)).toEqual([ids.early, ...tie, ids.late]);
    expect(list.map((a) => a.startTime)).toEqual(["18:00", "19:30", "19:30", "21:00"]);
  });

  it("does not list a reservation that has already ended", async () => {
    // Monday 2026-11-09 is today: book 18:00-20:00 and 20:30-22:30, then it is 20:15.
    const ended = idOf(await reserve({ date: "2026-11-09", time: "18:00", partySize: 2, email: "e@mail.com" }));
    const upcoming = idOf(await reserve({ date: "2026-11-09", time: "20:30", partySize: 2, email: "u@mail.com" }));
    current = new Date("2026-11-09T20:15:00Z");
    const res = await addClosed("2026-11-09");
    const list = (res.body as { affectedReservations: Affected[] }).affectedReservations;
    expect(list.map((a) => a.id)).toEqual([upcoming]);
    expect(list.map((a) => a.id)).not.toContain(ended);
  });

  it("reports the table name of a table removed afterwards", async () => {
    // A reservation on a table that was removed (only possible through data repair): the
    // report still resolves the name.
    const id = await bookGuest();
    await Table.updateOne({ _id: tableOf("T5").id }, { $set: { removed: true, removedAt: START } });
    const res = await addClosed(THURSDAY);
    expect((res.body as { affectedReservations: Affected[] }).affectedReservations).toEqual([expected(id)]);
  });

  it("is complete: not paginated", async () => {
    await Table.deleteMany({});
    await seedRestaurant({
      tables: Array.from({ length: 30 }, (_v, i) => ({ name: `X${i}`, capacity: 2 })),
      schedule: { thursday: [DINNER] },
    });
    for (let i = 0; i < 30; i++) {
      const res = await reserve({ date: THURSDAY, time: "20:00", partySize: 2, email: `g${i}@mail.com` });
      expect(res.status).toBe(201);
    }
    const res = await addClosed(THURSDAY);
    expect((res.body as { affectedReservations: Affected[] }).affectedReservations).toHaveLength(30);
  });
});

describe("001 behavior around the changed operations", () => {
  it("401 without a token on the changed operations", async () => {
    expectError(await kept(app).post("/closed-dates").send({ date: THURSDAY }), 401, "AUTHENTICATION_REQUIRED");
    expectError(await kept(app).put("/schedule").send({ days: [] }), 401, "AUTHENTICATION_REQUIRED");
    expectError(await kept(app).patch(`/tables/${tableOf("T5").id}`).send({ capacity: 2 }), 401, "AUTHENTICATION_REQUIRED");
  });

  it("the 001 error lists are unchanged", async () => {
    expect((await addClosed(THURSDAY)).status).toBe(201);
    expectError(await addClosed(THURSDAY), 409, "CONFLICT");
    expectError(await addClosed("2026-11-08"), 400, "VALIDATION_ERROR");
    expectError(await putSchedule([{ day: "funday", periods: [] }]), 400, "VALIDATION_ERROR");
    expectError(await patchTable("0123456789abcdef01234567", { capacity: 2 }), 404, "NOT_FOUND");
    expectError(await patchTable(tableOf("T5").id, {}), 400, "VALIDATION_ERROR");
    await seedRestaurant({ tables: [{ name: "T1", capacity: 2 }] });
    expectError(await patchTable(tableOf("T5").id, { name: "t1" }), 409, "CONFLICT");
  });

  it("a refused 001 conflict carries no details", async () => {
    await addClosed(THURSDAY);
    const error = expectError(await addClosed(THURSDAY), 409, "CONFLICT");
    expect(error).not.toHaveProperty("details");
  });
});
