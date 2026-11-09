import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  localToUtc,
  overlaps,
  utcToLocal,
} from "../../src/shared/time/local-time.js";

const ZONES = ["UTC", "Europe/Madrid", "America/New_York", "America/Argentina/Buenos_Aires"];

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

describe("localToUtc / utcToLocal", () => {
  it.each([
    ["UTC", "2026-11-14", "20:00", "2026-11-14T20:00:00.000Z"],
    ["Europe/Madrid", "2026-11-14", "20:00", "2026-11-14T19:00:00.000Z"], // CET, UTC+1
    ["Europe/Madrid", "2026-07-01", "20:00", "2026-07-01T18:00:00.000Z"], // CEST, UTC+2
    ["America/New_York", "2026-12-25", "12:00", "2026-12-25T17:00:00.000Z"], // EST, UTC-5
    ["America/New_York", "2026-07-01", "12:00", "2026-07-01T16:00:00.000Z"], // EDT, UTC-4
    ["America/Argentina/Buenos_Aires", "2026-07-01", "12:00", "2026-07-01T15:00:00.000Z"],
  ])("%s %s %s → %s", (zone, date, time, iso) => {
    const instant = localToUtc(date, time, zone);
    expect(instant?.toISOString()).toBe(iso);
    expect(utcToLocal(instant!, zone)).toEqual({ date, time });
  });

  it.each(ZONES)("round-trips every 15-minute time of ordinary days in %s", (zone) => {
    for (const date of ["2026-01-15", "2026-06-15", "2026-03-28", "2026-03-30", "2026-11-02"]) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const time = hhmm(minutes);
        const instant = localToUtc(date, time, zone);
        expect(instant, `${zone} ${date} ${time}`).not.toBeNull();
        expect(utcToLocal(instant!, zone)).toEqual({ date, time });
      }
    }
  });

  it("returns null for a time inside a DST gap", () => {
    expect(localToUtc("2026-03-29", "02:30", "Europe/Madrid")).toBeNull();
    expect(localToUtc("2026-03-29", "02:00", "Europe/Madrid")).toBeNull();
    expect(localToUtc("2026-03-08", "02:30", "America/New_York")).toBeNull();
  });

  it("returns a real instant right before and right after a DST gap", () => {
    expect(localToUtc("2026-03-29", "01:59", "Europe/Madrid")?.toISOString()).toBe(
      "2026-03-29T00:59:00.000Z",
    );
    expect(localToUtc("2026-03-29", "03:00", "Europe/Madrid")?.toISOString()).toBe(
      "2026-03-29T01:00:00.000Z",
    );
  });

  it("returns the first (earlier) instant for a time inside a DST fold", () => {
    // CEST first occurrence (the second one is 01:30Z, CET)
    expect(localToUtc("2026-10-25", "02:30", "Europe/Madrid")?.toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    // EDT first occurrence
    expect(localToUtc("2026-11-01", "01:30", "America/New_York")?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("utcToLocal formats both occurrences of a folded time", () => {
    expect(utcToLocal(new Date("2026-10-25T00:30:00Z"), "Europe/Madrid")).toEqual({
      date: "2026-10-25",
      time: "02:30",
    });
    expect(utcToLocal(new Date("2026-10-25T01:30:00Z"), "Europe/Madrid")).toEqual({
      date: "2026-10-25",
      time: "02:30",
    });
  });

  it("utcToLocal moves across the date line of the zone", () => {
    expect(utcToLocal(new Date("2026-11-14T23:30:00Z"), "Europe/Madrid")).toEqual({
      date: "2026-11-15",
      time: "00:30",
    });
    expect(utcToLocal(new Date("2026-11-14T02:30:00Z"), "America/New_York")).toEqual({
      date: "2026-11-13",
      time: "21:30",
    });
  });

  it("formats midnight as 00:00, never 24:00", () => {
    expect(utcToLocal(new Date("2026-11-14T00:00:00Z"), "UTC")).toEqual({
      date: "2026-11-14",
      time: "00:00",
    });
    expect(localToUtc("2026-11-14", "00:00", "Europe/Madrid")?.toISOString()).toBe(
      "2026-11-13T23:00:00.000Z",
    );
  });
});

describe("addDays", () => {
  it.each([
    ["2026-11-14", 1, "2026-11-15"],
    ["2026-11-30", 1, "2026-12-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"], // leap day
    ["2028-02-29", 1, "2028-03-01"],
    ["2026-02-28", 1, "2026-03-01"], // not a leap year
    ["2026-11-09", 60, "2027-01-08"],
    ["2026-11-14", 0, "2026-11-14"],
  ])("addDays(%s, %i) = %s", (date, n, expected) => {
    expect(addDays(date, n)).toBe(expected);
  });
});

describe("dayOfWeek", () => {
  it.each([
    ["2026-11-14", "saturday"],
    ["2026-11-15", "sunday"],
    ["2026-11-09", "monday"],
    ["2026-11-10", "tuesday"],
    ["2026-11-11", "wednesday"],
    ["2026-11-12", "thursday"],
    ["2026-11-13", "friday"],
    ["2028-02-29", "tuesday"],
  ])("%s is %s", (date, day) => {
    expect(dayOfWeek(date)).toBe(day);
  });
});

describe("overlaps (half-open)", () => {
  const at = (time: string) => new Date(`2026-11-14T${time}:00Z`);
  const range = (a: string, b: string) => ({ start: at(a), end: at(b) });

  it("is true for intersecting ranges, in both argument orders", () => {
    expect(overlaps(range("20:00", "22:00"), range("21:00", "23:00"))).toBe(true);
    expect(overlaps(range("21:00", "23:00"), range("20:00", "22:00"))).toBe(true);
  });

  it("is false when the ranges only touch", () => {
    expect(overlaps(range("20:00", "22:00"), range("22:00", "23:59"))).toBe(false);
    expect(overlaps(range("22:00", "23:59"), range("20:00", "22:00"))).toBe(false);
  });

  it("is true for containment and for identical ranges", () => {
    expect(overlaps(range("18:00", "23:00"), range("20:00", "21:00"))).toBe(true);
    expect(overlaps(range("20:00", "21:00"), range("18:00", "23:00"))).toBe(true);
    expect(overlaps(range("20:00", "22:00"), range("20:00", "22:00"))).toBe(true);
  });

  it("is false for disjoint ranges", () => {
    expect(overlaps(range("12:00", "14:00"), range("20:00", "22:00"))).toBe(false);
  });
});
