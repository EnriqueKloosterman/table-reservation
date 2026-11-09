import { describe, expect, it } from "vitest";
import {
  checkAvailability,
  type Reason,
} from "../../src/modules/availability/availability.domain.js";
import { iv, makeSnapshot, table } from "../helpers/day-snapshot.js";

const reasonOf = (result: ReturnType<typeof checkAvailability>) =>
  result.available ? null : result.reason;

describe("checkAvailability: one case per reason", () => {
  it("is available inside a period with a free table, returning the candidate tables", () => {
    const result = checkAvailability(makeSnapshot(), { time: "20:30", partySize: 4 });
    expect(result).toEqual({ available: true, tables: [table("t4", "T4", 4)] });
  });

  describe("too_soon", () => {
    it("refuses a date before today", () => {
      const snap = makeSnapshot({ date: "2026-11-08" });
      expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: 2 }))).toBe("too_soon");
    });

    it("accepts a start exactly at now + minimum notice and refuses one minute earlier", () => {
      const snap = makeSnapshot({
        date: "2026-11-09", // today; now = 10:00, notice 60 minutes
        periods: [{ name: "All day", start: "08:00", end: "23:30" }],
      });
      expect(checkAvailability(snap, { time: "11:00", partySize: 2 }).available).toBe(true);
      expect(reasonOf(checkAvailability(snap, { time: "10:59", partySize: 2 }))).toBe("too_soon");
    });

    it("with zero minimum notice a start exactly at now is accepted", () => {
      const snap = makeSnapshot({
        date: "2026-11-09",
        periods: [{ name: "All day", start: "08:00", end: "23:30" }],
        rules: { minNoticeMinutes: 0 },
      });
      expect(checkAvailability(snap, { time: "10:00", partySize: 2 }).available).toBe(true);
      expect(reasonOf(checkAvailability(snap, { time: "09:59", partySize: 2 }))).toBe("too_soon");
    });

    it("evaluates 'today' in the restaurant time zone", () => {
      // 2026-11-09T23:30Z is already 2026-11-10 00:30 in Madrid, so 2026-11-09 is in the past.
      const snap = makeSnapshot({
        now: new Date("2026-11-09T23:30:00Z"),
        date: "2026-11-09",
        periods: [{ name: "All day", start: "00:00", end: "23:59" }],
        rules: { timeZone: "Europe/Madrid" },
      });
      expect(reasonOf(checkAvailability(snap, { time: "12:00", partySize: 2 }))).toBe("too_soon");
    });
  });

  describe("too_far_ahead", () => {
    it("allows the inclusive horizon day and refuses the day after", () => {
      // today = 2026-11-09, horizon 60 days → 2027-01-08 is the last bookable date
      const periods = [{ name: "Dinner", start: "20:00", end: "23:30" }];
      const last = makeSnapshot({ date: "2027-01-08", periods });
      const beyond = makeSnapshot({ date: "2027-01-09", periods });
      expect(checkAvailability(last, { time: "20:30", partySize: 2 }).available).toBe(true);
      expect(reasonOf(checkAvailability(beyond, { time: "20:30", partySize: 2 }))).toBe(
        "too_far_ahead",
      );
    });
  });

  it("closed_date", () => {
    const snap = makeSnapshot({ isClosedDate: true });
    expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: 2 }))).toBe("closed_date");
  });

  it("closed_day: the weekday has no service periods", () => {
    const snap = makeSnapshot({ periods: [] });
    expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: 2 }))).toBe("closed_day");
  });

  describe("outside_service_hours", () => {
    it("refuses a time before the first period", () => {
      expect(reasonOf(checkAvailability(makeSnapshot(), { time: "17:00", partySize: 2 }))).toBe(
        "outside_service_hours",
      );
    });

    it("dinner 20:00-23:30 with 120 minutes: 21:30 is available, 21:45 is refused", () => {
      const snap = makeSnapshot();
      expect(checkAvailability(snap, { time: "21:30", partySize: 2 }).available).toBe(true);
      expect(reasonOf(checkAvailability(snap, { time: "21:45", partySize: 2 }))).toBe(
        "outside_service_hours",
      );
    });

    it("refuses a reservation that would span two periods", () => {
      const snap = makeSnapshot({
        periods: [
          { name: "Lunch", start: "12:00", end: "15:00" },
          { name: "Dinner", start: "15:00", end: "23:00" },
        ],
      });
      expect(reasonOf(checkAvailability(snap, { time: "14:00", partySize: 2 }))).toBe(
        "outside_service_hours",
      );
    });

    it("refuses a local time that does not exist (DST gap)", () => {
      const snap = makeSnapshot({
        now: new Date("2026-03-20T10:00:00Z"),
        date: "2026-03-29",
        periods: [{ name: "Night", start: "00:00", end: "23:59" }],
        rules: { timeZone: "Europe/Madrid" },
      });
      expect(reasonOf(checkAvailability(snap, { time: "02:30", partySize: 2 }))).toBe(
        "outside_service_hours",
      );
    });
  });

  describe("party_too_large", () => {
    it("when no table is big enough", () => {
      expect(reasonOf(checkAvailability(makeSnapshot(), { time: "20:30", partySize: 8 }))).toBe(
        "party_too_large",
      );
    });

    it("also when there are no tables at all", () => {
      const snap = makeSnapshot({ tables: [] });
      expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: 1 }))).toBe(
        "party_too_large",
      );
    });
  });

  describe("no_table_free", () => {
    it("when every suitable table has an overlapping interval", () => {
      const snap = makeSnapshot({
        intervalsByTable: new Map([["t4", [iv("2026-11-14", "19:00", "21:00")]]]),
      });
      expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: 4 }))).toBe(
        "no_table_free",
      );
    });

    it("an interval ending exactly when the new one starts does not overlap", () => {
      const snap = makeSnapshot({
        intervalsByTable: new Map([["t4", [iv("2026-11-14", "18:00", "20:00")]]]),
      });
      expect(checkAvailability(snap, { time: "20:00", partySize: 4 }).available).toBe(true);
    });

    it("an interval starting exactly when the new one ends does not overlap", () => {
      const snap = makeSnapshot({
        periods: [{ name: "Dinner", start: "18:00", end: "23:30" }],
        intervalsByTable: new Map([["t4", [iv("2026-11-14", "20:00", "22:00")]]]),
      });
      expect(checkAvailability(snap, { time: "18:00", partySize: 4 }).available).toBe(true);
      expect(reasonOf(checkAvailability(snap, { time: "18:15", partySize: 4 }))).toBe(
        "no_table_free",
      );
    });

    it("a held table of another size does not make a free suitable table unavailable", () => {
      const snap = makeSnapshot({
        tables: [table("t2", "T2", 2), table("t6", "T6", 6)],
        intervalsByTable: new Map([["t2", [iv("2026-11-14", "20:00", "22:00")]]]),
      });
      expect(checkAvailability(snap, { time: "20:30", partySize: 4 })).toEqual({
        available: true,
        tables: [table("t6", "T6", 6)],
      });
    });
  });
});

describe("checkAvailability: reason precedence (research R7)", () => {
  const party = 2;

  it("too_soon beats closed_date", () => {
    const snap = makeSnapshot({ date: "2026-11-08", isClosedDate: true });
    expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: party }))).toBe("too_soon");
  });

  it("too_far_ahead beats closed_date", () => {
    const snap = makeSnapshot({ date: "2027-02-01", isClosedDate: true });
    expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: party }))).toBe(
      "too_far_ahead",
    );
  });

  it("too_soon (notice) beats closed_day", () => {
    const snap = makeSnapshot({ date: "2026-11-09", periods: [] });
    expect(reasonOf(checkAvailability(snap, { time: "10:30", partySize: party }))).toBe("too_soon");
  });

  it("closed_date beats closed_day", () => {
    const snap = makeSnapshot({ isClosedDate: true, periods: [] });
    expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: party }))).toBe(
      "closed_date",
    );
  });

  it("closed_day beats outside_service_hours", () => {
    const snap = makeSnapshot({ periods: [] });
    expect(reasonOf(checkAvailability(snap, { time: "03:00", partySize: party }))).toBe(
      "closed_day",
    );
  });

  it("outside_service_hours beats party_too_large", () => {
    expect(reasonOf(checkAvailability(makeSnapshot(), { time: "17:00", partySize: 9 }))).toBe(
      "outside_service_hours",
    );
  });

  it("party_too_large beats no_table_free (a held small table does not hide the size reason)", () => {
    const snap = makeSnapshot({
      intervalsByTable: new Map([["t4", [iv("2026-11-14", "19:00", "21:00")]]]),
    });
    expect(reasonOf(checkAvailability(snap, { time: "20:30", partySize: 9 }))).toBe(
      "party_too_large",
    );
  });

  it("every reason value is produced by some case above", () => {
    const seen = new Set<Reason>([
      "too_soon",
      "too_far_ahead",
      "closed_date",
      "closed_day",
      "outside_service_hours",
      "party_too_large",
      "no_table_free",
    ]);
    expect(seen.size).toBe(7);
  });
});

describe("checkAvailability: tables", () => {
  it("returns the candidate tables ordered by capacity, then natural name order", () => {
    const snap = makeSnapshot({
      tables: [
        table("a", "T10", 4),
        table("b", "T2", 4),
        table("c", "Big", 8),
        table("d", "t3", 4),
        table("e", "Small", 2),
      ],
    });
    const result = checkAvailability(snap, { time: "20:30", partySize: 3 });
    expect(result.available && result.tables.map((t) => t.name)).toEqual(["T2", "t3", "T10", "Big"]);
  });

  it("only considers tables present in the snapshot (a removed table is never offered)", () => {
    // The snapshot loader excludes removed tables; intervals for an absent table are ignored.
    const snap = makeSnapshot({
      tables: [table("live", "Live", 4)],
      intervalsByTable: new Map([["removed", [iv("2026-11-14", "20:00", "22:00")]]]),
    });
    expect(checkAvailability(snap, { time: "20:30", partySize: 4 })).toEqual({
      available: true,
      tables: [table("live", "Live", 4)],
    });
  });

  it("does not mutate the snapshot", () => {
    const snap = makeSnapshot();
    const before = JSON.stringify([snap.tables, [...snap.intervalsByTable]]);
    checkAvailability(snap, { time: "20:30", partySize: 4 });
    expect(JSON.stringify([snap.tables, [...snap.intervalsByTable]])).toBe(before);
  });
});
