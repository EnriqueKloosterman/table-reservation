import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { isInsideSchedule } from "../../src/modules/reservations/affected.domain.js";
import { affectedBySchedule } from "../../src/modules/reservations/affected.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { DAYS, type DaySchedule } from "../../src/modules/schedule/schedule.domain.js";
import { addDays, dayOfWeek } from "../../src/shared/time/local-time.js";
import { useTestDatabase } from "../setup/db.js";

// `affectedBySchedule` filters inside MongoDB (so a staff change stays fast with thousands of
// reservations). `isInsideSchedule` is the rule; this proves the database expression agrees
// with it, over every weekday and a spread of times and schedules.
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Small deterministic generator, so a failure is reproducible. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomSchedule(rand: () => number): DaySchedule[] {
  return DAYS.map((day) => {
    const kind = Math.floor(rand() * 4); // 0 closed, 1 one period, 2 two periods, 3 touching periods
    const at = (min: number, max: number) => Math.floor(min + rand() * (max - min));
    const a = at(8 * 60, 14 * 60);
    const b = a + at(90, 240);
    const c = b + at(0, 3) * 30;
    const d = Math.min(c + at(90, 300), 23 * 60 + 59);
    const periods =
      kind === 0
        ? []
        : kind === 1
          ? [{ name: "One", start: hhmm(a), end: hhmm(b) }]
          : [
              { name: "One", start: hhmm(a), end: hhmm(b) },
              { name: "Two", start: hhmm(kind === 3 ? b : c), end: hhmm(d) },
            ];
    return { day, periods };
  });
}

describe("affectedBySchedule: the database filter agrees with isInsideSchedule", () => {
  it("over 200 reservations and 6 random schedules", async () => {
    const rand = lcg(20261109);
    const docs = Array.from({ length: 200 }, (_v, i) => {
      const date = addDays("2026-11-10", Math.floor(rand() * 21));
      const startMin = Math.floor(rand() * (22 * 60 / 15)) * 15;
      const startTime = hhmm(startMin);
      const endTime = hhmm(Math.min(startMin + 120, 23 * 60 + 59));
      const _id = new Types.ObjectId();
      return {
        _id,
        tableId: new Types.ObjectId(),
        date,
        startTime,
        endTime,
        startAt: new Date(`${date}T${startTime}:00Z`),
        endAt: new Date(`${date}T${endTime}:00Z`),
        partySize: 2,
        guestName: `Guest ${i}`,
        guestEmail: `g${i}@mail.com`,
        guestPhone: "600123456",
        secretCodeHash: new Types.ObjectId().toHexString().padStart(64, "0"),
        createdAt: NOW,
      };
    });
    await Reservation.insertMany(docs);

    let affectedTotal = 0;
    let insideTotal = 0;
    for (let round = 0; round < 6; round++) {
      const schedule = randomSchedule(rand);
      const periodsByDay = new Map(schedule.map((d) => [d.day, d.periods]));
      const expected = docs
        .filter((r) => !isInsideSchedule(r, periodsByDay.get(dayOfWeek(r.date)) ?? []))
        .map((r) => r._id.toHexString())
        .sort();
      const actual = (await affectedBySchedule(schedule, NOW)).map((a) => a.id).sort();
      expect(actual, `round ${round}`).toEqual(expected);
      affectedTotal += expected.length;
      insideTotal += docs.length - expected.length;
    }
    // the generator must exercise both outcomes
    expect(affectedTotal).toBeGreaterThan(100);
    expect(insideTotal).toBeGreaterThan(50);
  });

  it("an empty schedule affects every upcoming reservation; reservations that ended are ignored", async () => {
    const make = (date: string, startTime: string, endTime: string) => ({
      _id: new Types.ObjectId(),
      tableId: new Types.ObjectId(),
      date,
      startTime,
      endTime,
      startAt: new Date(`${date}T${startTime}:00Z`),
      endAt: new Date(`${date}T${endTime}:00Z`),
      partySize: 2,
      guestName: "G",
      guestEmail: `${date}${startTime}@mail.com`,
      guestPhone: "600123456",
      secretCodeHash: new Types.ObjectId().toHexString().padStart(64, "0"),
      createdAt: NOW,
    });
    await Reservation.insertMany([
      make("2026-11-14", "20:00", "22:00"),
      make("2026-11-15", "13:00", "15:00"),
      make("2026-11-01", "20:00", "22:00"), // ended
    ]);
    const closedWeek = DAYS.map((day) => ({ day, periods: [] }));
    expect(await affectedBySchedule(closedWeek, NOW)).toHaveLength(2);
  });
});
