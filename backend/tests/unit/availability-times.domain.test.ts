import { describe, expect, it } from "vitest";
import {
  checkAvailability,
  listBookableTimes,
  type DaySnapshot,
  type Interval,
} from "../../src/modules/availability/availability.domain.js";
import type { ServicePeriod } from "../../src/modules/schedule/schedule.domain.js";
import { toMinutes } from "../../src/modules/schedule/schedule.domain.js";
import { addDays, dayOfWeek } from "../../src/shared/time/local-time.js";
import { iv, makeSnapshot, table } from "../helpers/day-snapshot.js";

const LUNCH: ServicePeriod = { name: "Lunch", start: "12:00", end: "15:00" };
const DINNER: ServicePeriod = { name: "Dinner", start: "20:00", end: "23:30" };

describe("listBookableTimes: grid and grouping", () => {
  it("lists times from the period start every interval up to the last start that ends by period end", () => {
    const snap = makeSnapshot({ periods: [LUNCH] });
    expect(listBookableTimes(snap, { partySize: 2 })).toEqual({
      periods: [{ name: "Lunch", times: ["12:00", "12:15", "12:30", "12:45", "13:00"] }],
    });
  });

  it("honours a different slot interval and duration", () => {
    const snap = makeSnapshot({
      periods: [LUNCH],
      rules: { slotIntervalMinutes: 30, durationMinutes: 90 },
    });
    expect(listBookableTimes(snap, { partySize: 2 }).periods[0]!.times).toEqual([
      "12:00",
      "12:30",
      "13:00",
      "13:30",
    ]);
  });

  it("groups by period in chronological order with the stored names", () => {
    const snap = makeSnapshot({ periods: [LUNCH, DINNER] });
    const result = listBookableTimes(snap, { partySize: 2 });
    expect(result.periods.map((p) => p.name)).toEqual(["Lunch", "Dinner"]);
    expect(result.periods[1]!.times[0]).toBe("20:00");
    expect(result.periods[1]!.times.at(-1)).toBe("21:30");
    expect(result).not.toHaveProperty("reason");
  });

  it("omits periods that have no bookable time", () => {
    const snap = makeSnapshot({
      periods: [LUNCH, DINNER],
      intervalsByTable: new Map([["t4", [iv("2026-11-14", "11:00", "16:00")]]]),
    });
    const result = listBookableTimes(snap, { partySize: 2 });
    expect(result.periods.map((p) => p.name)).toEqual(["Dinner"]);
  });

  it("excludes exactly the times that overlap a held table", () => {
    const middle = makeSnapshot({
      periods: [{ name: "Dinner", start: "16:00", end: "23:30" }],
      intervalsByTable: new Map([["t4", [iv("2026-11-14", "20:00", "22:00")]]]),
    });
    const times = listBookableTimes(middle, { partySize: 4 }).periods[0]!.times;
    expect(times).toContain("18:00"); // ends 20:00, touches the held interval
    expect(times).not.toContain("18:15");
    expect(times).not.toContain("21:45");
    expect(times.at(-1)).toBe("18:00");

    const start = makeSnapshot({
      periods: [{ name: "Dinner", start: "18:00", end: "23:30" }],
      intervalsByTable: new Map([["t4", [iv("2026-11-14", "18:00", "20:00")]]]),
    });
    const after = listBookableTimes(start, { partySize: 4 }).periods[0]!.times;
    expect(after[0]).toBe("20:00"); // starts when the held interval ends
    expect(after).not.toContain("19:45");
  });

  it("lists only times that respect the minimum notice for today", () => {
    const snap = makeSnapshot({
      date: "2026-11-09",
      periods: [{ name: "Lunch", start: "10:00", end: "14:00" }],
    });
    // now 10:00 + 60 min notice → first bookable start is 11:00
    expect(listBookableTimes(snap, { partySize: 2 }).periods[0]!.times).toEqual([
      "11:00",
      "11:15",
      "11:30",
      "11:45",
      "12:00",
    ]);
  });
});

describe("listBookableTimes: reason of an empty list (FR-008 order)", () => {
  const reasonOf = (snap: DaySnapshot, partySize = 2) => {
    const result = listBookableTimes(snap, { partySize });
    expect(result.periods).toEqual([]);
    return result.reason;
  };

  it("date before today → too_soon", () => {
    expect(reasonOf(makeSnapshot({ date: "2026-11-08" }))).toBe("too_soon");
  });

  it("beyond the horizon → too_far_ahead", () => {
    expect(reasonOf(makeSnapshot({ date: "2027-01-09" }))).toBe("too_far_ahead");
  });

  it("closed date → closed_date", () => {
    expect(reasonOf(makeSnapshot({ isClosedDate: true }))).toBe("closed_date");
  });

  it("no periods → closed_day", () => {
    expect(reasonOf(makeSnapshot({ periods: [] }))).toBe("closed_day");
  });

  it("party larger than every table → party_too_large (also with no tables)", () => {
    expect(reasonOf(makeSnapshot(), 9)).toBe("party_too_large");
    expect(reasonOf(makeSnapshot({ tables: [] }), 1)).toBe("party_too_large");
  });

  it("no period long enough for a reservation → outside_service_hours", () => {
    const snap = makeSnapshot({ periods: [{ name: "Tapas", start: "13:00", end: "14:30" }] });
    expect(reasonOf(snap)).toBe("outside_service_hours");
  });

  it("minimum notice removes every remaining time → too_soon", () => {
    const snap = makeSnapshot({ date: "2026-11-09", periods: [LUNCH] }); // lunch times 12:00-13:00
    const late = { ...snap, now: new Date("2026-11-09T14:30:00Z") };
    expect(reasonOf(late)).toBe("too_soon");
  });

  it("every time held → no_table_free", () => {
    const snap = makeSnapshot({
      intervalsByTable: new Map([["t4", [iv("2026-11-14", "00:00", "23:59")]]]),
    });
    expect(reasonOf(snap, 4)).toBe("no_table_free");
  });

  it("party_too_large wins over outside_service_hours; closed_day over party_too_large", () => {
    const short = makeSnapshot({ periods: [{ name: "Tapas", start: "13:00", end: "14:00" }] });
    expect(reasonOf(short, 9)).toBe("party_too_large");
    expect(reasonOf(makeSnapshot({ periods: [], tables: [] }), 9)).toBe("closed_day");
  });

  it("a non-empty list never carries a reason", () => {
    expect(listBookableTimes(makeSnapshot(), { partySize: 2 })).not.toHaveProperty("reason");
  });
});

describe("SC-004 property: every listed time passes checkAvailability and vice versa", () => {
  const WEEK: Record<string, ServicePeriod[]> = {
    monday: [],
    tuesday: [LUNCH, DINNER],
    wednesday: [{ name: "Brunch", start: "09:30", end: "13:10" }, DINNER],
    thursday: [{ name: "All day", start: "00:00", end: "23:59" }],
    friday: [LUNCH, { name: "Late", start: "22:00", end: "23:30" }],
    saturday: [{ name: "Night", start: "01:00", end: "04:00" }, DINNER],
    // Sunday is the DST-change day in every zone of the cases below: the period covers the gap.
    sunday: [{ name: "Night", start: "00:30", end: "05:30" }, LUNCH],
  };

  const tables = [table("t2", "T2", 2), table("t4", "T4", 4), table("t10", "T10", 4), table("t8", "T8", 8)];

  function held(date: string): Map<string, Interval[]> {
    return new Map([
      ["t4", [iv(date, "12:30", "14:30"), iv(date, "20:00", "22:00")]],
      ["t10", [iv(date, "13:00", "15:00")]],
      ["t2", [iv(date, "20:30", "22:30")]],
    ]);
  }

  function gridTimes(periods: ServicePeriod[], duration: number, step: number): string[] {
    const times: string[] = [];
    for (const p of periods) {
      for (let m = toMinutes(p.start); m + duration <= toMinutes(p.end); m += step) {
        times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      }
    }
    return times;
  }

  const cases: { zone: string; start: string; now: string; label: string }[] = [
    { zone: "UTC", start: "2026-11-09", now: "2026-11-09T10:00:00Z", label: "UTC week with a closed date" },
    { zone: "Europe/Madrid", start: "2026-03-23", now: "2026-03-23T09:00:00Z", label: "Madrid spring-forward week (2026-03-29)" },
    { zone: "Europe/Madrid", start: "2026-10-19", now: "2026-10-19T09:00:00Z", label: "Madrid fall-back week (2026-10-25)" },
    { zone: "America/New_York", start: "2026-03-02", now: "2026-03-02T15:00:00Z", label: "New York spring-forward week (2026-03-08)" },
  ];

  it.each(cases)("$label", ({ zone, start, now }) => {
    let checked = 0;
    let listedTotal = 0;
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(start, offset);
      const rules = {
        timeZone: zone,
        durationMinutes: 120,
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        horizonDays: 60,
      };
      const snap: DaySnapshot = {
        now: new Date(now),
        rules,
        date,
        periods: WEEK[dayOfWeek(date)]!,
        isClosedDate: offset === 3, // one closed date in the week
        tables,
        intervalsByTable: held(date),
      };
      for (const partySize of [1, 3, 5, 9]) {
        const listed = new Set(
          listBookableTimes(snap, { partySize }).periods.flatMap((p) => p.times),
        );
        listedTotal += listed.size;
        for (const time of gridTimes(snap.periods, 120, 15)) {
          const available = checkAvailability(snap, { time, partySize }).available;
          expect(listed.has(time), `${zone} ${date} ${time} party ${partySize}`).toBe(available);
          checked++;
        }
        // nothing listed that is not on the grid
        const grid = new Set(gridTimes(snap.periods, 120, 15));
        for (const time of listed) expect(grid.has(time)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(listedTotal).toBeGreaterThan(0);
  });
});
