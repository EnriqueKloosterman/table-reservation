import { afterEach, describe, expect, it } from "vitest";
import { formatDate, formatTime } from "../../src/shared/dates";

const ZONES = [
  "Etc/GMT+12",
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "UTC",
  "Europe/Madrid",
  "Asia/Kolkata",
  "Pacific/Kiritimati",
];

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("formatDate", () => {
  it("formats a valid date with weekday", () => {
    expect(formatDate("2026-11-14")).toBe("Saturday 14 November 2026");
  });

  it("accepts a leap day", () => {
    expect(formatDate("2028-02-29")).toBe("Tuesday 29 February 2028");
  });

  it.each(["2026-02-30", "2026-13-01", "14/11/2026", "", "2026-1-1", "2026-11-14T00:00"])(
    "returns the neutral text for %j and never throws",
    (value) => {
      expect(formatDate(value)).toBe("Date not available");
    },
  );

  it.each(ZONES)("gives the same output in %s", (zone) => {
    process.env.TZ = zone;
    expect(formatDate("2026-11-14")).toBe("Saturday 14 November 2026");
    expect(formatDate("2026-03-29")).toBe("Sunday 29 March 2026");
    expect(formatDate("2026-10-25")).toBe("Sunday 25 October 2026");
  });
});

describe("formatTime", () => {
  it("returns a valid HH:mm unchanged", () => {
    expect(formatTime("09:30")).toBe("09:30");
    expect(formatTime("23:59")).toBe("23:59");
  });

  it.each(["9:30", "24:00", "12:60", "", "12:30:00", "noon"])(
    "returns the neutral text for %j",
    (value) => {
      expect(formatTime(value)).toBe("Time not available");
    },
  );
});
