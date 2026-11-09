import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { loginAs } from "../helpers/login-as.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

type Details = { field: string; reason: string }[];
type ClosedDateBody = { date: string; reason: string | null };

const NOW = new Date("2026-11-06T12:00:00Z"); // restaurant date 2026-11-06 in UTC
const app = buildTestApp({ now: NOW });
let token = "";

beforeEach(async () => {
  await seedStaff();
  token = await loginAs(app);
});

function client(target: Express, bearer: () => string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${bearer()}`);
  return {
    add: (body: unknown) => auth(request(target).post("/closed-dates")).send(body as object),
    list: (query = "") => auth(request(target).get(`/closed-dates${query}`)),
    remove: (date: string) => auth(request(target).delete(`/closed-dates/${date}`)),
  };
}

const api = client(app, () => token);
const fieldsOf = (details: unknown) => (details as Details).map((d) => d.field);
const datesOf = (body: unknown) => (body as ClosedDateBody[]).map((c) => c.date);

describe("POST /closed-dates", () => {
  it("US4 #1: adds a closed date", async () => {
    const res = await api.add({ date: "2026-12-25", reason: "Christmas" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ date: "2026-12-25", reason: "Christmas", affectedReservations: [] });
    expect(res.headers.location).toBeUndefined();
  });

  describe("reason handling", () => {
    it.each([
      ["absent", {}],
      ["null", { reason: null }],
      ["empty", { reason: "" }],
      ["whitespace", { reason: "   " }],
    ])("%s reason → null", async (_label, extra) => {
      const res = await api.add({ date: "2026-12-25", ...extra });
      expect(res.status).toBe(201);
      expect((res.body as ClosedDateBody).reason).toBeNull();
    });

    it("trims the reason", async () => {
      const res = await api.add({ date: "2026-12-25", reason: "  Private event " });
      expect((res.body as ClosedDateBody).reason).toBe("Private event");
    });

    it("accepts 200 chars and refuses 201 chars after trim", async () => {
      expect((await api.add({ date: "2026-12-24", reason: ` ${"r".repeat(200)} ` })).status).toBe(201);
      const error = expectError(
        await api.add({ date: "2026-12-25", reason: "r".repeat(201) }),
        400,
        "VALIDATION_ERROR",
      );
      expect(fieldsOf(error.details)).toEqual(["reason"]);
    });
  });

  it("US4 #3: re-adding a closed date → 409", async () => {
    await api.add({ date: "2026-12-25" });
    expectError(await api.add({ date: "2026-12-25" }), 409, "CONFLICT");
  });

  it("concurrent double-add → one 201, one 409", async () => {
    const results = await Promise.all([api.add({ date: "2026-12-25" }), api.add({ date: "2026-12-25" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ClosedDate.countDocuments()).toBe(1);
  });

  describe("US4 #4: date validation", () => {
    it.each(["2026-02-30", "2026-1-5", "26-12-25", "2026-11-05"])("%s → 400 field date", async (date) => {
      const error = expectError(await api.add({ date }), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["date"]);
    });

    it("accepts today", async () => {
      expect((await api.add({ date: "2026-11-06" })).status).toBe(201);
    });

    it("refuses a missing or null date and unknown fields", async () => {
      expect(fieldsOf(expectError(await api.add({}), 400, "VALIDATION_ERROR").details)).toEqual(["date"]);
      expect(fieldsOf(expectError(await api.add({ date: null }), 400, "VALIDATION_ERROR").details)).toEqual(["date"]);
      const error = expectError(await api.add({ date: "2026-12-25", note: "x" }), 400, "VALIDATION_ERROR");
      expect(error.details).toEqual([{ field: "note", reason: "Unknown field" }]);
    });

    it("re-adding a past date that is already closed → 400, not 409", async () => {
      await ClosedDate.create({ date: "2026-11-01", reason: null });
      const error = expectError(await api.add({ date: "2026-11-01" }), 400, "VALIDATION_ERROR");
      expect(fieldsOf(error.details)).toEqual(["date"]);
    });
  });

  it("accepts a date on a weekday closed in the weekly schedule", async () => {
    const put = await request(app)
      .put("/schedule")
      .set("Authorization", `Bearer ${token}`)
      .send({ days: [{ day: "monday", periods: [{ name: "Lunch", start: "12:00", end: "15:00" }] }] });
    expect(put.status).toBe(200);
    // 2026-12-25 is a Friday, closed in that schedule
    expect((await api.add({ date: "2026-12-25" })).status).toBe(201);
  });
});

describe("GET /closed-dates", () => {
  beforeEach(async () => {
    await api.add({ date: "2026-12-31" });
    await api.add({ date: "2026-11-20" });
    await api.add({ date: "2026-11-06" });
    await ClosedDate.create({ date: "2026-11-01", reason: "Past" });
  });

  it("US4 #2: lists from today onwards in ascending order", async () => {
    const res = await api.list();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { date: "2026-11-06", reason: null },
      { date: "2026-11-20", reason: null },
      { date: "2026-12-31", reason: null },
    ]);
  });

  it("includes past closures with includePast=true", async () => {
    expect(datesOf((await api.list("?includePast=true")).body)).toEqual([
      "2026-11-01",
      "2026-11-06",
      "2026-11-20",
      "2026-12-31",
    ]);
  });

  it("includePast=false is the default", async () => {
    expect((await api.list("?includePast=false")).body).toEqual((await api.list()).body);
  });

  it.each([
    ["?includePast=TRUE", "query.includePast"],
    ["?includePast=1", "query.includePast"],
    ["?includePast=yes", "query.includePast"],
    ["?includePast=", "query.includePast"],
    ["?includePast=true&includePast=false", "query.includePast"],
    ["?foo=1", "query.foo"],
  ])("%s → 400 field %s", async (query, field) => {
    const error = expectError(await api.list(query), 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual([field]);
  });
});

describe("restaurant time zone boundary", () => {
  async function zoneClient(timeZone: string, now: Date) {
    const zoned = buildTestApp({ timeZone, now });
    const zonedToken = await loginAs(zoned);
    return client(zoned, () => zonedToken);
  }

  it("Pacific/Kiritimati: restaurant date is ahead of UTC", async () => {
    const kiri = await zoneClient("Pacific/Kiritimati", new Date("2026-11-06T23:30:00Z"));
    expect((await kiri.add({ date: "2026-11-07" })).status).toBe(201);
    const error = expectError(await kiri.add({ date: "2026-11-06" }), 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual(["date"]);
  });

  it("Pacific/Pago_Pago: restaurant date is behind UTC", async () => {
    const pago = await zoneClient("Pacific/Pago_Pago", new Date("2026-11-07T05:00:00Z"));
    expect((await pago.add({ date: "2026-11-06" })).status).toBe(201);
  });

  it("the default list filter uses the restaurant date", async () => {
    await ClosedDate.create({ date: "2026-11-06", reason: null });
    await ClosedDate.create({ date: "2026-11-07", reason: null });
    const kiri = await zoneClient("Pacific/Kiritimati", new Date("2026-11-06T23:30:00Z"));
    expect(datesOf((await kiri.list()).body)).toEqual(["2026-11-07"]);
  });
});

describe("DELETE /closed-dates/:date", () => {
  it("US4 #5: removes a closure, then 404", async () => {
    await api.add({ date: "2026-12-25", reason: "Christmas" });
    const res = await api.remove("2026-12-25");
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(datesOf((await api.list()).body)).toEqual([]);
    expectError(await api.remove("2026-12-25"), 404, "NOT_FOUND");
  });

  it("decodes the path segment before validation", async () => {
    await api.add({ date: "2026-12-25" });
    expect((await api.remove("2026%2D12%2D25")).status).toBe(204);
  });

  it.each(["2026-02-30", "abc"])("%s → 400 field params.date", async (date) => {
    const error = expectError(await api.remove(date), 400, "VALIDATION_ERROR");
    expect(fieldsOf(error.details)).toEqual(["params.date"]);
  });

  it("can remove a past closure", async () => {
    await ClosedDate.create({ date: "2026-11-01", reason: null });
    expect((await api.remove("2026-11-01")).status).toBe(204);
    expect(await ClosedDate.countDocuments()).toBe(0);
  });

  it("no token → 401 even for a malformed date", async () => {
    expectError(await request(app).delete("/closed-dates/abc"), 401, "AUTHENTICATION_REQUIRED");
  });
});
