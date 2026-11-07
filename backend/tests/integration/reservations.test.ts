import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

// "Now" is Monday 2026-11-09 10:00 UTC; the upcoming Saturday is 2026-11-14.
const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAY = "2026-11-14";
const CLOSED = "2026-11-21";

const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

const app = buildTestApp({ now: NOW });

beforeEach(async () => {
  await seedRestaurant({
    tables: [
      { name: "T2", capacity: 2 },
      { name: "T4", capacity: 4 },
      { name: "T6", capacity: 6 },
    ],
    schedule: {
      saturday: [DINNER],
      sunday: [{ name: "Night", start: "00:30", end: "05:30" }],
    },
    closedDates: [CLOSED],
  });
});

const reserve = (over: Record<string, unknown> = {}, target: Express = app) => reserveAs(target, over);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function nothingStored() {
  expect(await Reservation.countDocuments({})).toBe(0);
  expect(await TableDay.countDocuments({})).toBe(0);
  expect(await GuestDay.countDocuments({})).toBe(0);
}

async function intervalCount(): Promise<{ tables: number; guests: number }> {
  const tables = (await TableDay.find({}).lean()).reduce((n, d) => n + d.intervals.length, 0);
  const guests = (await GuestDay.find({}).lean()).reduce((n, d) => n + d.intervals.length, 0);
  return { tables, guests };
}

describe("POST /reservations: success", () => {
  it("US2 #1: party 3 gets the capacity-4 table and the confirmation has every field", async () => {
    const res = await reserve({
      partySize: 3,
      time: "20:30",
      name: "  Ana García ",
      email: " Ana@Mail.com ",
      phone: " +34 600 123 456 ",
    });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/) as string,
      status: "confirmed",
      date: SATURDAY,
      startTime: "20:30",
      endTime: "22:30",
      partySize: 3,
      guest: { name: "Ana García", email: "ana@mail.com", phone: "+34 600 123 456" },
      table: { name: "T4" },
      createdAt: NOW.toISOString(),
      secretCode: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as string,
    });
  });

  it("stores the reservation with a hash of the code and never the code itself", async () => {
    const res = await reserve({ partySize: 3, time: "20:30" });
    const body = res.body as { id: string; secretCode: string };
    const stored = await Reservation.findById(body.id).select("+secretCodeHash").lean();
    expect(stored).not.toBeNull();
    expect(stored!.secretCodeHash).toBe(sha256(body.secretCode));
    expect(JSON.stringify(stored)).not.toContain(body.secretCode);
    expect(stored).toMatchObject({
      status: "confirmed",
      date: SATURDAY,
      startTime: "20:30",
      endTime: "22:30",
      partySize: 3,
      guestName: "Ana Guest",
      guestEmail: "ana@mail.com",
      guestPhone: "+34 600 111 222",
    });
    expect(stored!.startAt).toEqual(new Date("2026-11-14T20:30:00Z"));
    expect(stored!.endAt).toEqual(new Date("2026-11-14T22:30:00Z"));
    expect(stored!.createdAt).toEqual(NOW);
    // the default query does not select the hash
    const plain = await Reservation.findById(body.id).lean();
    expect(plain).not.toHaveProperty("secretCodeHash");
    const asJson = (await Reservation.findById(body.id))!.toJSON();
    expect(asJson).not.toHaveProperty("secretCodeHash");
  });

  it("holds the interval for the table and for the guest", async () => {
    const res = await reserve({ partySize: 3, time: "20:30", email: "Ana@Mail.com" });
    const { id } = res.body as { id: string };
    const stored = await Reservation.findById(id).lean();
    const tableDay = await TableDay.findOne({ tableId: stored!.tableId, date: SATURDAY }).lean();
    const guestDay = await GuestDay.findOne({ email: "ana@mail.com", date: SATURDAY }).lean();
    for (const day of [tableDay, guestDay]) {
      expect(day!.intervals).toHaveLength(1);
      expect(day!.intervals[0]!.reservationId.toHexString()).toBe(id);
      expect(day!.intervals[0]!.start).toEqual(new Date("2026-11-14T20:30:00Z"));
      expect(day!.intervals[0]!.end).toEqual(new Date("2026-11-14T22:30:00Z"));
    }
  });

  it("US2 #2 (natural order): of equal capacities, T2 is assigned before T10", async () => {
    await Table.deleteMany({});
    await seedRestaurant({
      tables: [
        { name: "T10", capacity: 4 },
        { name: "t2", capacity: 4 },
      ],
    });
    const res = await reserve({ partySize: 4 });
    expect((res.body as { table: { name: string } }).table.name).toBe("t2");
    const second = await reserve({ partySize: 4, email: "b@mail.com" });
    expect((second.body as { table: { name: string } }).table.name).toBe("T10");
  });

  it("US2 #3: the only table for 6 held 18:00-20:00 refuses 19:00 and accepts 20:00", async () => {
    const first = await reserve({ partySize: 6, time: "18:00", email: "a@mail.com" });
    expect(first.status).toBe(201);
    const tableName = (first.body as { table: { name: string } }).table.name;

    const refused = await reserve({ partySize: 6, time: "19:00", email: "b@mail.com" });
    const error = expectError(refused, 409, "NO_AVAILABILITY");
    expect(error.details).toEqual({ reason: "no_table_free" });

    const accepted = await reserve({ partySize: 6, time: "20:00", email: "c@mail.com" });
    expect(accepted.status).toBe(201);
    expect((accepted.body as { table: { name: string } }).table.name).toBe(tableName);
  });

  it("a refused request leaves no table or guest hold behind", async () => {
    await reserve({ partySize: 6, time: "18:00", email: "a@mail.com" });
    const before = await intervalCount();
    expectError(await reserve({ partySize: 6, time: "19:00", email: "b@mail.com" }), 409, "NO_AVAILABILITY");
    expect(await intervalCount()).toEqual(before);
    expect(await Reservation.countDocuments({})).toBe(1);
  });
});

describe("POST /reservations: availability refusals (US2 #5)", () => {
  it.each([
    ["a closed date", { date: CLOSED, time: "20:00" }, "closed_date"],
    ["a weekday without service", { date: "2026-11-16", time: "20:00" }, "closed_day"],
    ["a time outside service hours", { time: "12:00" }, "outside_service_hours"],
    ["a reservation that would end after the period", { time: "21:45" }, "outside_service_hours"],
    ["a party larger than every table", { partySize: 9 }, "party_too_large"],
    ["a past date", { date: "2026-11-08" }, "too_soon"],
    ["a date beyond the horizon", { date: "2027-01-09" }, "too_far_ahead"],
  ])("%s → 409 NO_AVAILABILITY %s and nothing is stored", async (_label, over, reason) => {
    const error = expectError(await reserve(over), 409, "NO_AVAILABILITY");
    expect(error.details).toEqual({ reason });
    await nothingStored();
  });

  it("a nonexistent DST-gap time is outside_service_hours", async () => {
    const madrid = buildTestApp({ timeZone: "Europe/Madrid", now: new Date("2026-03-20T10:00:00Z") });
    const error = expectError(await reserve({ date: "2026-03-29", time: "02:30" }, madrid), 409, "NO_AVAILABILITY");
    expect(error.details).toEqual({ reason: "outside_service_hours" });
    await nothingStored();
  });

  it("works in a non-UTC restaurant time zone, storing UTC instants", async () => {
    const madrid = buildTestApp({ timeZone: "Europe/Madrid", now: NOW });
    const res = await reserve({ time: "20:30" }, madrid);
    expect(res.status).toBe(201);
    const stored = await Reservation.findById((res.body as { id: string }).id).lean();
    expect(stored!.startAt).toEqual(new Date("2026-11-14T19:30:00Z")); // CET, UTC+1
    expect(stored!.endAt).toEqual(new Date("2026-11-14T21:30:00Z"));
    expect(stored).toMatchObject({ date: SATURDAY, startTime: "20:30", endTime: "22:30" });
  });
});

describe("POST /reservations: validation (US2 #6)", () => {
  const fieldsOf = (details: unknown) => (details as { field: string }[]).map((d) => d.field).sort();

  it("lists every offending field and stores nothing", async () => {
    const error = expectError(
      await reserve({ name: "", email: "nope", phone: "12" }),
      400,
      "VALIDATION_ERROR",
    );
    expect(fieldsOf(error.details)).toEqual(["email", "name", "phone"]);
    await nothingStored();
  });

  it("refuses an unknown field", async () => {
    const error = expectError(await reserve({ tableId: "x" }), 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "tableId", reason: "Unknown field" }]);
    await nothingStored();
  });

  it("refuses a string party size and a non-JSON body", async () => {
    expectError(await reserve({ partySize: "3" }), 400, "VALIDATION_ERROR");
    expectError(
      await request(app).post("/reservations").set("Content-Type", "text/plain").send("hello"),
      400,
      "VALIDATION_ERROR",
    );
    await nothingStored();
  });

  it("validation comes before availability: an invalid body for a closed date is a 400", async () => {
    expectError(await reserve({ date: CLOSED, email: "nope" }), 400, "VALIDATION_ERROR");
  });
});

describe("POST /reservations: duplicate guest (US2 #7)", () => {
  it("refuses an overlapping reservation for the same email, ignoring case and spaces", async () => {
    expect((await reserve({ time: "18:00", email: "ana@mail.com", partySize: 2 })).status).toBe(201);
    const before = await intervalCount();

    const res = await reserve({ time: "19:00", email: " Ana@Mail.com ", partySize: 5 });
    const error = expectError(res, 409, "CONFLICT");
    expect(error.details).toEqual({ reason: "duplicate_reservation" });
    // reveals nothing about the other reservation
    const text = JSON.stringify(res.body);
    for (const leak of ["18:00", "20:00", "T2", "T4", "T6", SATURDAY]) expect(text).not.toContain(leak);

    expect(await Reservation.countDocuments({})).toBe(1);
    expect(await intervalCount()).toEqual(before);
  });

  it("a reservation for the same email starting when the first ends succeeds", async () => {
    await reserve({ time: "18:00", email: "ana@mail.com" });
    expect((await reserve({ time: "20:00", email: "ANA@mail.com" })).status).toBe(201);
  });

  it("the same email on another date succeeds", async () => {
    expect((await reserve({ time: "18:00", email: "ana@mail.com" })).status).toBe(201);
    expect((await reserve({ date: "2026-11-28", time: "18:00", email: "ana@mail.com" })).status).toBe(201);
  });

  it("duplicate beats unavailability when both apply", async () => {
    await reserve({ time: "18:00", email: "ana@mail.com" });
    const error = expectError(await reserve({ time: "19:00", partySize: 9, email: "ana@mail.com" }), 409, "CONFLICT");
    expect(error.details).toEqual({ reason: "duplicate_reservation" });
  });

  it("other emails are not affected", async () => {
    await reserve({ time: "18:00", email: "ana@mail.com" });
    expect((await reserve({ time: "18:00", email: "bea@mail.com" })).status).toBe(201);
  });
});

describe("POST /reservations: secret code (US2 #9)", () => {
  const logs = () => [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
  afterEach(() => vi.restoreAllMocks());

  it("appears only in the creation response, never in any later operation or log", async () => {
    const spies = logs();
    const res = await reserve({ partySize: 6, time: "20:00" });
    const { id, secretCode } = res.body as { id: string; secretCode: string };

    const later = [
      await request(app).get("/availability").query({ date: SATURDAY, time: "20:30", partySize: "6" }),
      await reserve({ partySize: 6, time: "20:30", email: "b@mail.com" }), // no_table_free
      await reserve({ partySize: 6, time: "20:30" }), // duplicate
      await reserve({ email: "bad" }), // validation
    ];
    for (const r of later) expect(JSON.stringify(r.body)).not.toContain(secretCode);
    for (const r of later) expect(JSON.stringify(r.headers)).not.toContain(secretCode);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(secretCode);

    const stored = await Reservation.findById(id).select("+secretCodeHash").lean();
    expect(stored!.secretCodeHash).not.toBe(secretCode);
  });

  it("is different for every reservation", async () => {
    const a = await reserve({ time: "18:00", email: "a@mail.com" });
    const b = await reserve({ time: "18:00", email: "b@mail.com" });
    expect((a.body as { secretCode: string }).secretCode).not.toBe((b.body as { secretCode: string }).secretCode);
  });
});

describe("POST /reservations: effect on availability", () => {
  it("after a reservation, an overlapping time reports no_table_free for the held table", async () => {
    await reserve({ partySize: 6, time: "20:00" });
    const held = await request(app).get("/availability").query({ date: SATURDAY, time: "20:30", partySize: "6" });
    expect(held.body).toMatchObject({ available: false, reason: "no_table_free" });
    const smaller = await request(app).get("/availability").query({ date: SATURDAY, time: "20:30", partySize: "2" });
    expect(smaller.body).toMatchObject({ available: true });
  });
});

describe("POST /reservations: public and test hooks", () => {
  it("needs no token, and a bogus Authorization header is ignored", async () => {
    const res = await reserve().set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(201);
  });

  it("production wiring never sets the test hooks", () => {
    const server = readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
    expect(server).not.toMatch(/afterClaim|testHooks|reservationOps/);
  });
});

describe("POST /reservations: request-level errors (contract §Check order, CHK012)", () => {
  it("malformed JSON → 400 VALIDATION_ERROR on field body, nothing stored", async () => {
    const res = await request(app)
      .post("/reservations")
      .set("Content-Type", "application/json")
      .send('{"date":');
    expect(expectError(res, 400, "VALIDATION_ERROR").details).toEqual([{ field: "body", reason: "Malformed JSON" }]);
    await nothingStored();
  });

  it("a body over 100 kB → 400 VALIDATION_ERROR, nothing stored", async () => {
    const res = await request(app)
      .post("/reservations")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ ...{ date: SATURDAY }, name: "x".repeat(110_000) }));
    expect(expectError(res, 400, "VALIDATION_ERROR").details).toEqual([
      { field: "body", reason: "Request body exceeds 100 kB" },
    ]);
    await nothingStored();
  });

  it("a JSON array or null body → 400 VALIDATION_ERROR", async () => {
    for (const body of ["[]", "null", '"text"']) {
      const res = await request(app).post("/reservations").set("Content-Type", "application/json").send(body);
      expectError(res, 400, "VALIDATION_ERROR");
    }
    await nothingStored();
  });
});

describe("a requested time need not be one of the listed times (spec §Edge Cases)", () => {
  it("any hour and minute is accepted by the check and by the reservation", async () => {
    const check = await request(app).get("/availability").query({ date: SATURDAY, time: "20:07", partySize: "2" });
    expect(check.body).toMatchObject({ available: true });
    const res = await reserve({ time: "20:07" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startTime: "20:07", endTime: "22:07" });
  });
});

describe("POST /reservations: a name longer than 100 UTF-16 units is a validation error, never a 500", () => {
  it("51 emoji (102 units) → 400 on field name, nothing stored", async () => {
    const res = await reserve({ name: "😀".repeat(51) });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect((error.details as { field: string }[]).map((d) => d.field)).toEqual(["name"]);
    await nothingStored();
  });

  it("50 emoji (100 units) are stored and echoed intact", async () => {
    const res = await reserve({ name: "😀".repeat(50) });
    expect(res.status).toBe(201);
    expect((res.body as { guest: { name: string } }).guest.name).toBe("😀".repeat(50));
  });
});
