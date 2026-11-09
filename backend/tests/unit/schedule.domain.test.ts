import { describe, expect, it } from "vitest";
import {
  DAYS,
  toMinutes,
  validateWeeklySchedule,
  type DayName,
} from "../../src/modules/schedule/schedule.domain.js";

type Period = { name: string; start: string; end: string };
const day = (d: DayName, ...periods: Period[]) => ({ day: d, periods });
const p = (name: string, start: string, end: string): Period => ({ name, start, end });

function errorsOf(input: Parameters<typeof validateWeeklySchedule>[0]) {
  const result = validateWeeklySchedule(input);
  if (result.ok) throw new Error("expected validation errors");
  return result.errors;
}

describe("toMinutes", () => {
  it.each([
    ["00:00", 0],
    ["23:59", 1439],
    ["12:30", 750],
  ])("%s → %i", (time, minutes) => {
    expect(toMinutes(time)).toBe(minutes);
  });
});

describe("validateWeeklySchedule", () => {
  it("normalizes: 7 days Monday-first, missing days empty, periods sorted, names trimmed", () => {
    const result = validateWeeklySchedule({
      days: [
        day("sunday", p(" Dinner ", "20:00", "23:00"), p("Lunch", "12:00", "15:00")),
        day("tuesday", p("Lunch", "12:00", "15:00")),
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        days: DAYS.map((d) => ({
          day: d,
          periods:
            d === "sunday"
              ? [p("Lunch", "12:00", "15:00"), p("Dinner", "20:00", "23:00")]
              : d === "tuesday"
                ? [p("Lunch", "12:00", "15:00")]
                : [],
        })),
      },
    });
  });

  it("allows adjacent periods", () => {
    const result = validateWeeklySchedule({
      days: [day("monday", p("A", "12:00", "15:00"), p("B", "15:00", "18:00"))],
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["end equal to start", "12:00", "12:00"],
    ["end before start", "15:00", "12:00"],
  ])("refuses %s on the period's end", (_label, start, end) => {
    expect(errorsOf({ days: [day("monday"), day("tuesday", p("Lunch", start, end))] })).toEqual([
      { field: "days[1].periods[0].end", reason: "tuesday 'Lunch': end must be after start" },
    ]);
  });

  it("reports an overlap on the later-starting period, using the submitted index", () => {
    const errors = errorsOf({
      days: [day("tuesday", p("Late lunch", "14:00", "17:00"), p("Lunch", "12:00", "15:00"))],
    });
    expect(errors).toEqual([
      {
        field: "days[0].periods[0].start",
        reason: "tuesday 'Late lunch' overlaps 'Lunch' (12:00-15:00)",
      },
    ]);
  });

  it("detects an overlap with an earlier long period, not only the previous one", () => {
    const errors = errorsOf({
      days: [day("monday", p("Long", "12:00", "18:00"), p("A", "13:00", "14:00"), p("B", "15:00", "16:00"))],
    });
    expect(errors.map((e) => e.field)).toEqual([
      "days[0].periods[1].start",
      "days[0].periods[2].start",
    ]);
  });

  it("refuses duplicate names (trimmed, case-insensitive) on the second occurrence", () => {
    const errors = errorsOf({
      days: [day("wednesday", p("Lunch", "12:00", "13:00"), p(" lunch ", "20:00", "21:00"))],
    });
    expect(errors).toEqual([
      { field: "days[0].periods[1].name", reason: "wednesday: duplicate period name 'lunch'" },
    ]);
  });

  it("refuses a repeated day on its second occurrence", () => {
    const errors = errorsOf({ days: [day("monday"), day("friday"), day("monday")] });
    expect(errors).toEqual([{ field: "days[2].day", reason: "monday: day appears more than once" }]);
  });

  it("returns every error across days in one result", () => {
    const errors = errorsOf({
      days: [
        day("monday", p("A", "10:00", "09:00")),
        day("tuesday", p("A", "12:00", "15:00"), p("B", "14:00", "16:00")),
        day("wednesday", p("X", "08:00", "09:00"), p("x", "10:00", "11:00")),
      ],
    });
    expect(errors.map((e) => e.field)).toEqual([
      "days[0].periods[0].end",
      "days[1].periods[1].start",
      "days[2].periods[1].name",
    ]);
  });
});
