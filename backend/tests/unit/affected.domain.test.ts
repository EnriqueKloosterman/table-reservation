import { describe, expect, it } from "vitest";
import { isInsideSchedule } from "../../src/modules/reservations/affected.domain.js";

const LUNCH = { name: "Lunch", start: "12:00", end: "15:00" };
const DINNER = { name: "Dinner", start: "20:00", end: "23:30" };

describe("isInsideSchedule", () => {
  it("is true when the reservation lies inside one period", () => {
    expect(isInsideSchedule({ startTime: "20:30", endTime: "22:30" }, [LUNCH, DINNER])).toBe(true);
  });

  it("is true when it starts exactly at the period start", () => {
    expect(isInsideSchedule({ startTime: "20:00", endTime: "22:00" }, [DINNER])).toBe(true);
  });

  it("is true when it ends exactly at the period end", () => {
    expect(isInsideSchedule({ startTime: "21:30", endTime: "23:30" }, [DINNER])).toBe(true);
  });

  it("is false when it starts before the period start", () => {
    expect(isInsideSchedule({ startTime: "19:45", endTime: "21:45" }, [DINNER])).toBe(false);
  });

  it("is false when it ends after the period end", () => {
    expect(isInsideSchedule({ startTime: "21:45", endTime: "23:45" }, [DINNER])).toBe(false);
  });

  it("is false when it spans two periods, even touching ones", () => {
    const touching = [
      { name: "A", start: "12:00", end: "14:00" },
      { name: "B", start: "14:00", end: "18:00" },
    ];
    expect(isInsideSchedule({ startTime: "13:00", endTime: "15:00" }, touching)).toBe(false);
  });

  it("is false when there are no periods (closed day)", () => {
    expect(isInsideSchedule({ startTime: "20:00", endTime: "22:00" }, [])).toBe(false);
  });

  it("is false when it falls between two periods", () => {
    expect(isInsideSchedule({ startTime: "16:00", endTime: "18:00" }, [LUNCH, DINNER])).toBe(false);
  });

  it("compares minutes, not text", () => {
    const early = [{ name: "Brunch", start: "09:30", end: "13:10" }];
    expect(isInsideSchedule({ startTime: "10:00", endTime: "12:00" }, early)).toBe(true);
    expect(isInsideSchedule({ startTime: "11:15", endTime: "13:15" }, early)).toBe(false);
  });
});
