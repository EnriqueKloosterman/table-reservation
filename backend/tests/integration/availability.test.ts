import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { seedRestaurant, type SeededTable } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

// "Now" is Monday 2026-11-09 10:00 UTC. The upcoming Saturday is 2026-11-14.
const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAY = "2026-11-14";
const FRIDAY = "2026-11-13";
const CLOSED = "2026-11-21"; // a Saturday marked as closed
const MONDAY = "2026-11-16"; // a weekday without service periods

const LUNCH = { name: "Lunch", start: "12:00", end: "15:00" };
const DINNER = { name: "Dinner", start: "20:00", end: "23:30" };

const app = buildTestApp({ now: NOW });
let tables: SeededTable[] = [];

async function seed() {
  const seeded = await seedRestaurant({
    tables: [
      { name: "T2", capacity: 2 },
      { name: "T4", capacity: 4 },
      { name: "T6", capacity: 6 },
    ],
    schedule: {
      friday: [LUNCH, DINNER],
      saturday: [DINNER],
      sunday: [{ name: "Night", start: "00:30", end: "05:30" }, LUNCH],
    },
    closedDates: [{ date: CLOSED, reason: "Private event" }],
  });
  tables = seeded.tables;
}

beforeEach(seed);

const ask = (target: Express, query: Record<string, string>) =>
  request(target).get("/availability").query(query);

const check = (date: string, time: string, partySize: number | string, target: Express = app) =>
  ask(target, { date, time, partySize: String(partySize) });

const tableId = (name: string) => tables.find((t) => t.name === name)!.id;

async function hold(name: string, date: string, from: string, to: string) {
  await TableDay.updateOne(
    { tableId: new Types.ObjectId(tableId(name)), date },
    {
      $push: {
        intervals: {
          reservationId: new Types.ObjectId(),
          start: new Date(`${date}T${from}:00Z`),
          end: new Date(`${date}T${to}:00Z`),
        },
      },
    },
    { upsert: true },
  );
}

describe("GET /availability: answers", () => {
  it("US1 #1: a party of 4 on an upcoming Saturday at 20:30 is available", async () => {
    const res = await check(SATURDAY, "20:30", 4);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ date: SATURDAY, time: "20:30", partySize: 4, available: true });
    expect(res.body).not.toHaveProperty("reason");
  });

  it("US1 #2: a party of 8 is party_too_large", async () => {
    const res = await check(SATURDAY, "20:30", 8);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: SATURDAY,
      time: "20:30",
      partySize: 8,
      available: false,
      reason: "party_too_large",
    });
  });

  it("US1 #3: a closed date is closed_date at any time", async () => {
    for (const time of ["12:00", "20:30", "03:00"]) {
      const res = await check(CLOSED, time, 2);
      expect(res.body).toMatchObject({ available: false, reason: "closed_date" });
    }
  });

  it("US1 #4: a weekday without periods is closed_day", async () => {
    for (const time of ["12:00", "20:30"]) {
      const res = await check(MONDAY, time, 2);
      expect(res.body).toMatchObject({ available: false, reason: "closed_day" });
    }
  });

  it("US1 #5: 17:00 with lunch and dinner is outside_service_hours", async () => {
    const res = await check(FRIDAY, "17:00", 2);
    expect(res.body).toMatchObject({ available: false, reason: "outside_service_hours" });
  });

  it("US1 #6: dinner 20:00-23:30 with 120 minutes: 21:30 is available, 21:45 is not", async () => {
    expect((await check(SATURDAY, "21:30", 2)).body).toMatchObject({ available: true });
    expect((await check(SATURDAY, "21:45", 2)).body).toMatchObject({
      available: false,
      reason: "outside_service_hours",
    });
  });

  it("US1 #7: every suitable table held over the requested time is no_table_free", async () => {
    await hold("T4", SATURDAY, "19:00", "21:00");
    await hold("T6", SATURDAY, "20:00", "22:00");
    const res = await check(SATURDAY, "20:30", 4);
    expect(res.body).toMatchObject({ available: false, reason: "no_table_free" });
    // a party of 2 still has T2
    expect((await check(SATURDAY, "20:30", 2)).body).toMatchObject({ available: true });
  });

  it("an interval ending exactly when the requested one starts does not block it", async () => {
    await hold("T4", SATURDAY, "18:00", "20:00");
    await hold("T6", SATURDAY, "18:00", "20:00");
    expect((await check(SATURDAY, "20:00", 4)).body).toMatchObject({ available: true });
  });

  describe("US1 #8: booking window", () => {
    it("a past date is too_soon", async () => {
      const res = await check("2026-11-08", "20:30", 2);
      expect(res.body).toMatchObject({ available: false, reason: "too_soon" });
    });

    it("a start inside the minimum notice is too_soon, at the boundary it is not", async () => {
      // now is Monday 10:00, notice 60 minutes: 10:59 is too soon, 11:00 is not (Monday: closed_day)
      expect((await check("2026-11-09", "10:59", 2)).body).toMatchObject({ reason: "too_soon" });
      expect((await check("2026-11-09", "11:00", 2)).body).toMatchObject({ reason: "closed_day" });
    });

    it("the last day of the horizon is still bookable, the next one is too_far_ahead", async () => {
      // today 2026-11-09 + 60 days = Friday 2027-01-08
      expect((await check("2027-01-08", "20:30", 2)).body).toMatchObject({ available: true });
      expect((await check("2027-01-09", "20:30", 2)).body).toMatchObject({
        available: false,
        reason: "too_far_ahead",
      });
    });
  });

  it("a removed table is never considered", async () => {
    await seedRestaurant({ tables: [{ name: "Old big", capacity: 10, removed: true }] });
    expect((await check(SATURDAY, "20:30", 8)).body).toMatchObject({
      available: false,
      reason: "party_too_large",
    });
    // and a removed table's held interval does not matter either
    const removed = await check(SATURDAY, "20:30", 6);
    expect(removed.body).toMatchObject({ available: true });
  });

  it("with no tables every party is party_too_large", async () => {
    await Table.deleteMany({});
    expect((await check(SATURDAY, "20:30", 1)).body).toMatchObject({ reason: "party_too_large" });
  });

  it("a nonexistent local time (DST gap) is outside_service_hours", async () => {
    const madrid = buildTestApp({
      timeZone: "Europe/Madrid",
      now: new Date("2026-03-20T10:00:00Z"),
    });
    const res = await check("2026-03-29", "02:30", 2, madrid);
    expect(res.body).toMatchObject({ available: false, reason: "outside_service_hours" });
    expect((await check("2026-03-29", "01:00", 2, madrid)).body).toMatchObject({ available: true });
  });
});

describe("GET /availability: restaurant time zone", () => {
  it("'today' is decided in the restaurant zone, not in UTC", async () => {
    // 2026-11-09T23:30Z is already 2026-11-10 00:30 in Madrid.
    const madrid = buildTestApp({ timeZone: "Europe/Madrid", now: new Date("2026-11-09T23:30:00Z") });
    expect((await check("2026-11-09", "20:30", 2, madrid)).body).toMatchObject({
      available: false,
      reason: "too_soon",
    });
    // the same instant in a UTC restaurant: 2026-11-09 is still today (closed_day on Monday)
    const utc = buildTestApp({ timeZone: "UTC", now: new Date("2026-11-09T23:30:00Z") });
    expect((await check("2026-11-09", "23:59", 2, utc)).body).toMatchObject({ reason: "too_soon" });
    expect((await check("2026-11-10", "20:30", 2, utc)).body).toMatchObject({ reason: "closed_day" });
  });

  it("the minimum notice is applied to the local start time", async () => {
    // 20:30 Madrid on Saturday 2026-11-14 (CET, UTC+1) is 19:30Z.
    const early = buildTestApp({ timeZone: "Europe/Madrid", now: new Date("2026-11-14T18:30:00Z") });
    expect((await check(SATURDAY, "20:30", 2, early)).body).toMatchObject({ available: true });
    const late = buildTestApp({ timeZone: "Europe/Madrid", now: new Date("2026-11-14T18:45:00Z") });
    expect((await check(SATURDAY, "20:30", 2, late)).body).toMatchObject({ reason: "too_soon" });
  });

  it("claimed intervals are compared as UTC instants", async () => {
    const madrid = buildTestApp({ timeZone: "Europe/Madrid", now: NOW });
    // Madrid 20:30 on 2026-11-14 (CET) = 19:30Z-21:30Z; hold every suitable table 19:00Z-21:00Z.
    await hold("T4", SATURDAY, "19:00", "21:00");
    await hold("T6", SATURDAY, "19:00", "21:00");
    expect((await check(SATURDAY, "20:30", 4, madrid)).body).toMatchObject({ reason: "no_table_free" });
    // Holds that end exactly at 19:30Z (the start) do not overlap.
    await TableDay.deleteMany({});
    await hold("T4", SATURDAY, "17:30", "19:30");
    await hold("T6", SATURDAY, "17:30", "19:30");
    expect((await check(SATURDAY, "20:30", 4, madrid)).body).toMatchObject({ available: true });
  });
});

describe("GET /availability: response rules", () => {
  it("reason is present if and only if available is false", async () => {
    const yes = (await check(SATURDAY, "20:30", 2)).body as Record<string, unknown>;
    const no = (await check(SATURDAY, "17:00", 2)).body as Record<string, unknown>;
    expect(yes.available).toBe(true);
    expect("reason" in yes).toBe(false);
    expect(no.available).toBe(false);
    expect(typeof no.reason).toBe("string");
  });

  it("never reveals the table", async () => {
    const text = JSON.stringify((await check(SATURDAY, "20:30", 4)).body);
    for (const t of tables) {
      expect(text).not.toContain(t.id);
      expect(text).not.toContain(t.name);
    }
    expect(Object.keys((await check(SATURDAY, "20:30", 4)).body as object).sort()).toEqual([
      "available",
      "date",
      "partySize",
      "time",
    ]);
  });

  it("is public: no Authorization header needed, and a bogus one is ignored", async () => {
    expect((await check(SATURDAY, "20:30", 2)).status).toBe(200);
    const withBogus = await ask(app, { date: SATURDAY, time: "20:30", partySize: "2" }).set(
      "Authorization",
      "Bearer not-a-token",
    );
    expect(withBogus.status).toBe(200);
  });

  it("is not cacheable", async () => {
    const res = await check(SATURDAY, "20:30", 2);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("does not write anything", async () => {
    const before = await TableDay.countDocuments({});
    await check(SATURDAY, "20:30", 4);
    expect(await TableDay.countDocuments({})).toBe(before);
  });
});

describe("GET /availability: validation (US1 #9)", () => {
  const fieldsOf = (details: unknown) => (details as { field: string }[]).map((d) => d.field).sort();
  const valid = { date: SATURDAY, time: "20:30", partySize: "4" };

  it.each([
    ["date", "2026-02-30"],
    ["date", "2026-1-5"],
    ["date", "tomorrow"],
    ["date", ""],
    ["time", "24:00"],
    ["time", "7:30"],
    ["time", "20:60"],
    ["time", "20:30:00"],
    ["time", ""],
    ["partySize", "0"],
    ["partySize", "51"],
    ["partySize", "04"],
    ["partySize", "4.0"],
    ["partySize", "abc"],
    ["partySize", "-1"],
    ["partySize", "+4"],
    ["partySize", " 4"],
    ["partySize", ""],
  ])("refuses %s=%j", async (name, value) => {
    const res = await ask(app, { ...valid, [name]: value });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual([`query.${name}`]);
  });

  it("reports every offending field at once", async () => {
    const res = await ask(app, { date: "nope", time: "99:99", partySize: "0" });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual(["query.date", "query.partySize", "query.time"]);
  });

  it("refuses missing parameters, naming each", async () => {
    const error = expectError(await request(app).get("/availability"), 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual(["query.date", "query.partySize", "query.time"]);
  });

  it("refuses a repeated partySize", async () => {
    const res = await request(app).get(`/availability?date=${SATURDAY}&time=20:30&partySize=2&partySize=3`);
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual(["query.partySize"]);
  });

  it("refuses an unknown query parameter", async () => {
    const res = await ask(app, { ...valid, vip: "yes" });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "query.vip", reason: "Unknown field" }]);
  });

  it("accepts the boundary party sizes 1 and 50", async () => {
    expect((await check(SATURDAY, "20:30", 1)).status).toBe(200);
    const fifty = await check(SATURDAY, "20:30", 50);
    expect(fifty.status).toBe(200);
    expect(fifty.body).toMatchObject({ reason: "party_too_large" });
  });

  it("validation completes before any read (a refused request touches nothing)", async () => {
    const res = await check("2026-13-40", "20:30", 2);
    expect(res.status).toBe(400);
  });
});
