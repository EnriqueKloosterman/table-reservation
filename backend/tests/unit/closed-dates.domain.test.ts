import { describe, expect, it } from "vitest";
import {
  isValidCalendarDate,
  todayInTimeZone,
} from "../../src/modules/closed-dates/closed-dates.domain.js";

describe("isValidCalendarDate", () => {
  it.each(["2026-12-25", "2028-02-29", "2000-02-29", "2026-01-31", "2026-04-30"])(
    "accepts %s",
    (date) => {
      expect(isValidCalendarDate(date)).toBe(true);
    },
  );

  it.each([
    "2026-02-30",
    "2026-02-29",
    "1900-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-01-00",
    "2026-1-5",
    "26-12-25",
    "2026/12/25",
    "2026-12-25T00:00",
    "",
  ])("refuses %j", (date) => {
    expect(isValidCalendarDate(date)).toBe(false);
  });
});

describe("todayInTimeZone", () => {
  it("is ahead of UTC in Pacific/Kiritimati (UTC+14)", () => {
    expect(todayInTimeZone("Pacific/Kiritimati", new Date("2026-11-06T23:30:00Z"))).toBe(
      "2026-11-07",
    );
  });

  it("is behind UTC in Pacific/Pago_Pago (UTC-11)", () => {
    expect(todayInTimeZone("Pacific/Pago_Pago", new Date("2026-11-07T05:00:00Z"))).toBe(
      "2026-11-06",
    );
  });

  it("matches the UTC date in UTC", () => {
    expect(todayInTimeZone("UTC", new Date("2026-11-06T23:59:59Z"))).toBe("2026-11-06");
    expect(todayInTimeZone("UTC", new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});
