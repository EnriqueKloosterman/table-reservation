import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { WeeklySchedule } from "../../src/modules/schedule/schedule.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { loginAs } from "../helpers/login-as.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

type Details = { field: string; reason: string }[];
type Period = { name: string; start: string; end: string };

const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const app = buildTestApp();
let token = "";

beforeEach(async () => {
  await seedStaff();
  token = await loginAs(app);
});

const getSchedule = () => request(app).get("/schedule").set("Authorization", `Bearer ${token}`);
const putSchedule = (body: unknown) =>
  request(app).put("/schedule").set("Authorization", `Bearer ${token}`).send(body as object);
const fieldsOf = (details: unknown) => (details as Details).map((d) => d.field);
const p = (name: string, start: string, end: string): Period => ({ name, start, end });

const LUNCH = p("Lunch", "12:00", "15:00");
const DINNER = p("Dinner", "20:00", "23:30");

/** Tuesday–Sunday lunch + dinner, Monday closed. */
const standardWeek = {
  days: [
    { day: "monday", periods: [] },
    ...WEEK.slice(1).map((day) => ({ day, periods: [LUNCH, DINNER] })),
  ],
};

describe("GET /schedule", () => {
  it("US3 #1: returns 7 empty days before any update, without writing", async () => {
    const res = await getSchedule();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: WEEK.map((day) => ({ day, periods: [] })) });
    expect(await WeeklySchedule.countDocuments()).toBe(0);
  });
});

describe("PUT /schedule", () => {
  it("US3 #2: stores the schedule and returns it normalized", async () => {
    const res = await putSchedule(standardWeek);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(standardWeek);
    expect((await getSchedule()).body).toEqual(res.body);
  });

  it("normalizes day order, period order, names and omitted days", async () => {
    const res = await putSchedule({
      days: [
        { day: "saturday", periods: [p(" Dinner ", "20:00", "23:30"), p("Lunch ", "12:00", "15:00")] },
        { day: "monday", periods: [LUNCH] },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      days: WEEK.map((day) => ({
        day,
        periods: day === "saturday" ? [LUNCH, DINNER] : day === "monday" ? [LUNCH] : [],
      })),
    });
  });

  it("replaces the whole schedule", async () => {
    await putSchedule(standardWeek);
    await putSchedule({ days: [{ day: "friday", periods: [DINNER] }] });
    const body = (await getSchedule()).body as { days: { day: string; periods: Period[] }[] };
    expect(body.days.filter((d) => d.periods.length > 0).map((d) => d.day)).toEqual(["friday"]);
  });

  describe("cross-item rules (US3 #3, #4, #6)", () => {
    it("end ≤ start → error on end", async () => {
      const error = expectError(
        await putSchedule({ days: [{ day: "monday", periods: [p("Lunch", "15:00", "12:00")] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].periods[0].end"]);
    });

    it("overlap → error on the later-starting period's start", async () => {
      const error = expectError(
        await putSchedule({
          days: [
            { day: "monday", periods: [] },
            { day: "tuesday", periods: [LUNCH, p("Late lunch", "14:00", "16:00")] },
          ],
        }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details).toEqual([
        {
          field: "days[1].periods[1].start",
          reason: "tuesday 'Late lunch' overlaps 'Lunch' (12:00-15:00)",
        },
      ]);
    });

    it("duplicate name in a day → error on the second occurrence's name", async () => {
      const error = expectError(
        await putSchedule({
          days: [{ day: "wednesday", periods: [LUNCH, p(" lunch ", "20:00", "21:00")] }],
        }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].periods[1].name"]);
    });

    it("repeated day → error on the second occurrence's day", async () => {
      const error = expectError(
        await putSchedule({ days: [{ day: "monday", periods: [] }, { day: "monday", periods: [] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[1].day"]);
    });
  });

  describe("US3 #5: format errors", () => {
    it.each(["25:00", "12:7", "9:00", "24:00"])("start %s → field start", async (start) => {
      const error = expectError(
        await putSchedule({ days: [{ day: "monday", periods: [p("Lunch", start, "23:00")] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].periods[0].start"]);
    });

    it("invalid end → field end", async () => {
      const error = expectError(
        await putSchedule({ days: [{ day: "monday", periods: [p("Lunch", "12:00", "24:00")] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].periods[0].end"]);
    });

    it("unknown day → field day", async () => {
      const error = expectError(
        await putSchedule({ days: [{ day: "funday", periods: [] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].day"]);
    });

    it.each([
      ["empty", "  "],
      ["51-char", "n".repeat(51)],
    ])("%s name → field name", async (_label, name) => {
      const error = expectError(
        await putSchedule({ days: [{ day: "monday", periods: [p(name, "12:00", "15:00")] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].periods[0].name"]);
    });

    it("unknown field in a period → Unknown field", async () => {
      const error = expectError(
        await putSchedule({ days: [{ day: "monday", periods: [{ ...LUNCH, color: "red" }] }] }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details).toEqual([{ field: "days[0].periods[0].color", reason: "Unknown field" }]);
    });

    it("missing days → field days", async () => {
      const error = expectError(await putSchedule({}), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["days"]);
    });
  });

  describe("validation stages", () => {
    it("a shape error and an overlap → only the shape error", async () => {
      const error = expectError(
        await putSchedule({
          days: [
            { day: "monday", periods: [p("Lunch", "25:00", "15:00")] },
            { day: "tuesday", periods: [LUNCH, p("Late", "14:00", "16:00")] },
          ],
        }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["days[0].periods[0].start"]);
    });

    it("two cross-item errors on different days → both", async () => {
      const error = expectError(
        await putSchedule({
          days: [
            { day: "tuesday", periods: [LUNCH, p("Late", "14:00", "16:00")] },
            { day: "wednesday", periods: [LUNCH, p("lunch", "20:00", "21:00")] },
          ],
        }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual([
        "days[0].periods[1].start",
        "days[1].periods[1].name",
      ]);
    });
  });

  it("US3 #7 / FR-024: a refused update leaves the stored schedule unchanged", async () => {
    const first = (await putSchedule(standardWeek)).body as unknown;
    expectError(
      await putSchedule({ days: [{ day: "monday", periods: [LUNCH, p("Late", "14:00", "16:00")] }] }),
      400,
      "VALIDATION_ERROR",
    );
    expect((await getSchedule()).body).toEqual(first);
  });

  describe("body edge cases and check order", () => {
    const cases: [string, string, string][] = [
      ["malformed JSON", "application/json", '{"days":'],
      ["oversized body", "application/json", JSON.stringify({ days: [], pad: "x".repeat(110_000) })],
      ["text/plain", "text/plain", "{}"],
    ];

    it.each(cases)("%s without a token → 401", async (_label, type, body) => {
      const res = await request(app).put("/schedule").set("Content-Type", type).send(body);
      expectError(res, 401, "AUTHENTICATION_REQUIRED");
    });

    it.each(cases)("%s with a token → 400 field body", async (_label, type, body) => {
      const res = await request(app)
        .put("/schedule")
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", type)
        .send(body);
      const error = expectError(res, 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["body"]);
    });
  });
});
