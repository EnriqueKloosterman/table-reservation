import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { toMinutes, type DayName, type ServicePeriod } from "../../src/modules/schedule/schedule.domain.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { kept } from "../helpers/keep-alive.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant, type SeededTable } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

// "Now" is Monday 2026-11-09 10:00 UTC; the upcoming Saturday is 2026-11-14.
const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAY = "2026-11-14";
const FRIDAY = "2026-11-13";
const CLOSED = "2026-11-21";
const TUESDAY = "2026-11-17"; // no service periods

const LUNCH = { name: "Lunch", start: "12:00", end: "15:00" };
const DINNER = { name: "Dinner", start: "20:00", end: "23:30" };

const app = buildTestApp({ now: NOW });
let tables: SeededTable[] = [];

beforeEach(async () => {
  const seeded = await seedRestaurant({
    tables: [
      { name: "T2", capacity: 2 },
      { name: "T4", capacity: 4 },
      { name: "T6", capacity: 6 },
    ],
    schedule: { friday: [LUNCH, DINNER], saturday: [LUNCH, DINNER], monday: [LUNCH] },
    closedDates: [CLOSED],
  });
  tables = seeded.tables;
});

const times = (date: string, partySize: number | string, target: Express = app) =>
  kept(target).get("/availability/times").query({ date, partySize: String(partySize) });

const tableId = (name: string) => new Types.ObjectId(tables.find((t) => t.name === name)!.id);

async function hold(name: string, date: string, from: string, to: string) {
  await TableDay.updateOne(
    { tableId: tableId(name), date },
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

type TimesBody = {
  date: string;
  partySize: number;
  periods: { name: string; times: string[] }[];
  reason?: string;
};

describe("GET /availability/times: answers", () => {
  it("US3 #1: lunch 12:00-15:00 for 2 lists 12:00 … 13:00 under 'Lunch'", async () => {
    const res = await times(SATURDAY, 2);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: SATURDAY,
      partySize: 2,
      periods: [
        { name: "Lunch", times: ["12:00", "12:15", "12:30", "12:45", "13:00"] },
        { name: "Dinner", times: ["20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30"] },
      ],
    });
  });

  it("US3 #2: the only table for 6 held 20:00-22:00 → no listed time overlaps it", async () => {
    await hold("T6", SATURDAY, "20:00", "22:00");
    const body = (await times(SATURDAY, 6)).body as TimesBody;
    expect(body.periods).toEqual([
      { name: "Lunch", times: ["12:00", "12:15", "12:30", "12:45", "13:00"] },
    ]);
    // dinner starts 20:00-21:30 all overlap [20:00, 22:00); nothing from Dinner is listed
    expect(body.periods.map((p) => p.name)).not.toContain("Dinner");
    expect(body).not.toHaveProperty("reason");
  });

  it("a hold ending exactly when a start time begins does not exclude it", async () => {
    await hold("T6", SATURDAY, "17:00", "20:00");
    const body = (await times(SATURDAY, 6)).body as TimesBody;
    expect(body.periods.find((p) => p.name === "Dinner")!.times[0]).toBe("20:00");
  });

  it("a hold removes only the times it overlaps, within the period", async () => {
    await hold("T6", SATURDAY, "12:30", "13:30");
    const lunch = ((await times(SATURDAY, 6)).body as TimesBody).periods.find((p) => p.name === "Lunch");
    // starts 12:00 → ends 14:00 overlaps; 12:15 … 13:00 overlap; none of lunch survives
    expect(lunch).toBeUndefined();
    const small = ((await times(SATURDAY, 2)).body as TimesBody).periods.find((p) => p.name === "Lunch")!;
    expect(small.times).toHaveLength(5); // other tables are free for a party of 2
  });

  it("omits periods without a bookable time and keeps chronological order", async () => {
    await hold("T6", FRIDAY, "11:00", "16:00");
    const body = (await times(FRIDAY, 6)).body as TimesBody;
    expect(body.periods.map((p) => p.name)).toEqual(["Dinner"]);
    const full = ((await times(SATURDAY, 6)).body as TimesBody).periods.map((p) => p.name);
    expect(full).toEqual(["Lunch", "Dinner"]);
  });

  it("a non-empty result carries no reason", async () => {
    expect(await times(SATURDAY, 2)).toHaveProperty("body.periods.length", 2);
    expect((await times(SATURDAY, 2)).body).not.toHaveProperty("reason");
  });

  describe("US3 #3: empty lists with a reason", () => {
    it.each([
      ["a closed date", CLOSED, 2, "closed_date"],
      ["a day with no service periods", TUESDAY, 2, "closed_day"],
      ["a party larger than every table", SATURDAY, 9, "party_too_large"],
      ["a past date", "2026-11-08", 2, "too_soon"],
      ["a date beyond the horizon", "2027-01-09", 2, "too_far_ahead"],
    ])("%s", async (_label, date, partySize, reason) => {
      const res = await times(date, partySize);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ date, partySize, periods: [], reason });
    });

    it("closed date wins over closed day and party size", async () => {
      expect((await times(CLOSED, 9)).body).toMatchObject({ reason: "closed_date" });
    });

    it("closed day wins over party_too_large", async () => {
      expect((await times(TUESDAY, 9)).body).toMatchObject({ reason: "closed_day" });
    });
  });

  it("US3 #4: an open day where every suitable table is held → no_table_free", async () => {
    await hold("T4", SATURDAY, "00:00", "23:59");
    await hold("T6", SATURDAY, "00:00", "23:59");
    expect((await times(SATURDAY, 4)).body).toEqual({
      date: SATURDAY,
      partySize: 4,
      periods: [],
      reason: "no_table_free",
    });
    // a party of 2 still has T2
    expect(((await times(SATURDAY, 2)).body as TimesBody).periods).not.toHaveLength(0);
  });

  it("outside_service_hours when no period is long enough for a reservation", async () => {
    await seedRestaurant({ schedule: { saturday: [{ name: "Tapas", start: "13:00", end: "14:30" }] } });
    expect((await times(SATURDAY, 2)).body).toMatchObject({ periods: [], reason: "outside_service_hours" });
  });

  describe("minimum notice", () => {
    it("US3 #5: today, late enough that notice rules everything out → too_soon", async () => {
      const late = buildTestApp({ now: new Date("2026-11-09T14:30:00Z") });
      expect((await times("2026-11-09", 2, late)).body).toEqual({
        date: "2026-11-09",
        partySize: 2,
        periods: [],
        reason: "too_soon",
      });
    });

    it("US3 #6: today only lists times that respect the minimum notice", async () => {
      // now 10:00 + 60 minutes: lunch 12:00-13:00 are all later than 11:00, so all listed
      expect(((await times("2026-11-09", 2)).body as TimesBody).periods[0]!.times[0]).toBe("12:00");
      // now 12:20 → earliest start 13:20 → only 13:30+? the last start is 13:00, so nothing → too_soon
      const mid = buildTestApp({ now: new Date("2026-11-09T12:20:00Z") });
      expect((await times("2026-11-09", 2, mid)).body).toMatchObject({ periods: [], reason: "too_soon" });
      // now 11:10 → earliest 12:10 → 12:15, 12:30, 12:45, 13:00
      const early = buildTestApp({ now: new Date("2026-11-09T11:10:00Z") });
      expect(((await times("2026-11-09", 2, early)).body as TimesBody).periods[0]!.times).toEqual([
        "12:15",
        "12:30",
        "12:45",
        "13:00",
      ]);
    });

    it("a booking rule of zero minimum notice lists times starting right now", async () => {
      const zero = buildTestApp({ now: new Date("2026-11-09T12:00:00Z"), bookingRules: { minNoticeMinutes: 0 } });
      expect(((await times("2026-11-09", 2, zero)).body as TimesBody).periods[0]!.times[0]).toBe("12:00");
    });
  });

  describe("booking rules and zones", () => {
    it("honours a custom slot interval and duration", async () => {
      const custom = buildTestApp({
        now: NOW,
        bookingRules: { slotIntervalMinutes: 30, durationMinutes: 90 },
      });
      const lunch = ((await times(SATURDAY, 2, custom)).body as TimesBody).periods[0]!;
      expect(lunch.times).toEqual(["12:00", "12:30", "13:00", "13:30"]);
    });

    it("does not list nonexistent local times on a DST-gap day", async () => {
      await seedRestaurant({ schedule: { sunday: [{ name: "Night", start: "00:30", end: "05:30" }] } });
      const madrid = buildTestApp({ timeZone: "Europe/Madrid", now: new Date("2026-03-20T10:00:00Z") });
      const listed = ((await times("2026-03-29", 2, madrid)).body as TimesBody).periods[0]!.times;
      for (const gap of ["02:00", "02:15", "02:30", "02:45"]) expect(listed).not.toContain(gap);
      expect(listed).toContain("01:45");
      expect(listed).toContain("03:00");
    });

    it("evaluates 'today' in the restaurant zone", async () => {
      const madrid = buildTestApp({ timeZone: "Europe/Madrid", now: new Date("2026-11-09T23:30:00Z") });
      expect((await times("2026-11-09", 2, madrid)).body).toMatchObject({ reason: "too_soon" });
    });
  });

  it("after a reservation, its times disappear from the list", async () => {
    const created = await reserveAs(app, { partySize: 6, time: "20:00" });
    expect(created.status).toBe(201);
    const dinner = ((await times(SATURDAY, 6)).body as TimesBody).periods.find((p) => p.name === "Dinner");
    expect(dinner).toBeUndefined();
  });
});

describe("GET /availability/times: response rules", () => {
  it("is not cacheable and needs no sign-in", async () => {
    const res = await times(SATURDAY, 2).set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("writes nothing", async () => {
    await times(SATURDAY, 2);
    expect(await TableDay.countDocuments({})).toBe(0);
    expect(await GuestDay.countDocuments({})).toBe(0);
    expect(await Reservation.countDocuments({})).toBe(0);
  });

  it("never reveals tables", async () => {
    const text = JSON.stringify((await times(SATURDAY, 2)).body);
    for (const t of tables) {
      expect(text).not.toContain(t.id);
      expect(text).not.toContain(`"${t.name}"`);
    }
  });
});

describe("GET /availability/times: validation", () => {
  const fieldsOf = (details: unknown) => (details as { field: string }[]).map((d) => d.field).sort();

  it.each([
    ["date", "2026-02-30"],
    ["date", "2026-1-5"],
    ["date", ""],
    ["partySize", "0"],
    ["partySize", "51"],
    ["partySize", "04"],
    ["partySize", "4.0"],
    ["partySize", "abc"],
    ["partySize", ""],
  ])("refuses %s=%j", async (name, value) => {
    const res = await request(app)
      .get("/availability/times")
      .query({ date: SATURDAY, partySize: "2", [name]: value });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual([`query.${name}`]);
  });

  it("reports every offending field at once and every missing one", async () => {
    const both = await request(app).get("/availability/times").query({ date: "nope", partySize: "0" });
    expect(fieldsOf(expectError(both, 400, "VALIDATION_ERROR").details)).toEqual(["query.date", "query.partySize"]);
    const none = await request(app).get("/availability/times");
    expect(fieldsOf(expectError(none, 400, "VALIDATION_ERROR").details)).toEqual(["query.date", "query.partySize"]);
  });

  it("refuses an unknown parameter, including `time`", async () => {
    for (const extra of ["time", "vip"]) {
      const res = await request(app)
        .get("/availability/times")
        .query({ date: SATURDAY, partySize: "2", [extra]: "20:00" });
      const error = expectError(res, 400, "VALIDATION_ERROR");
      expect(error.details).toEqual([{ field: `query.${extra}`, reason: "Unknown field" }]);
    }
  });

  it("refuses a repeated parameter", async () => {
    const res = await request(app).get(`/availability/times?date=${SATURDAY}&partySize=2&partySize=3`);
    expect(fieldsOf(expectError(res, 400, "VALIDATION_ERROR").details)).toEqual(["query.partySize"]);
  });
});

// ---------------------------------------------------------------------------------------------
// T041 / SC-004 over HTTP: one full week including a closed date.
// ---------------------------------------------------------------------------------------------

describe("SC-004 over HTTP: the list and the other operations agree for a full week", () => {
  const WEEK_START = "2026-11-09";
  const DAYS = Array.from({ length: 7 }, (_v, i) => {
    const d = new Date(Date.UTC(2026, 10, 9 + i));
    return d.toISOString().slice(0, 10);
  });
  const CLOSED_IN_WEEK = DAYS[2]!; // Wednesday

  const SCHEDULE: Record<DayName, ServicePeriod[]> = {
    monday: [{ name: "Late lunch", start: "11:00", end: "16:00" }],
    tuesday: [LUNCH, DINNER],
    wednesday: [LUNCH],
    thursday: [{ name: "Brunch", start: "09:30", end: "13:10" }, DINNER],
    friday: [{ name: "All day", start: "10:00", end: "23:30" }],
    saturday: [LUNCH, DINNER],
    sunday: [{ name: "Short", start: "13:00", end: "14:30" }, { name: "Supper", start: "19:00", end: "23:00" }],
  };

  function grid(date: string): string[] {
    const day = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[
      new Date(`${date}T00:00:00Z`).getUTCDay()
    ]!;
    const out: string[] = [];
    for (const p of SCHEDULE[day]) {
      for (let m = toMinutes(p.start); m + 120 <= toMinutes(p.end); m += 15) {
        out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      }
    }
    return out;
  }

  /** The same pre-existing holds on every pass, written straight into the calendar. */
  async function applyHolds() {
    for (const date of DAYS) {
      await hold("T4", date, "12:30", "14:30");
      await hold("T4", date, "20:00", "22:00");
      await hold("T6", date, "13:00", "15:00");
      await hold("T2", date, "20:30", "22:30");
    }
  }

  async function resetBookings() {
    await Promise.all([Reservation.deleteMany({}), TableDay.deleteMany({}), GuestDay.deleteMany({})]);
    await applyHolds();
  }

  beforeEach(async () => {
    await seedRestaurant({ schedule: SCHEDULE, closedDates: [CLOSED_IN_WEEK] });
    await applyHolds();
  });

  it("every listed time is accepted by GET /availability and POST /reservations; every other grid time is refused", async () => {
    expect(WEEK_START).toBe(DAYS[0]);
    let listedTotal = 0;
    let refusedTotal = 0;

    for (const date of DAYS) {
      for (const partySize of [2, 4, 6, 9]) {
        const body = (await times(date, partySize)).body as TimesBody;
        const listed = new Set(body.periods.flatMap((p) => p.times));
        listedTotal += listed.size;
        if (date === CLOSED_IN_WEEK) {
          expect(body).toMatchObject({ periods: [], reason: "closed_date" });
          continue;
        }

        for (const time of grid(date)) {
          const check = await kept(app).get("/availability")
            .query({ date, time, partySize: String(partySize) });
          expect(check.body, `${date} ${time} party ${partySize}`).toMatchObject({
            available: listed.has(time),
          });
          if (!listed.has(time)) refusedTotal++;
        }

        for (const time of listed) {
          await resetBookings();
          const created = await reserveAs(app, { date, time, partySize });
          expect(created.status, `POST ${date} ${time} party ${partySize}: ${JSON.stringify(created.body)}`).toBe(201);
        }
      }
    }

    expect(listedTotal).toBeGreaterThan(50);
    expect(refusedTotal).toBeGreaterThan(20);
  }, 180_000);

  it("the closed date lists nothing and refuses every time", async () => {
    const check = await kept(app).get("/availability")
      .query({ date: CLOSED_IN_WEEK, time: "12:00", partySize: "2" });
    expect(check.body).toMatchObject({ available: false, reason: "closed_date" });
    expect((await times(CLOSED_IN_WEEK, 2)).body).toMatchObject({ reason: "closed_date" });
  });
});
