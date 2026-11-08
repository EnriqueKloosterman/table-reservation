import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelAsStaff, cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { FakeEmailSender } from "../helpers/fake-email-sender.js";
import { kept } from "../helpers/keep-alive.js";
import { loginAs } from "../helpers/login-as.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, US4 / SC-006 / SC-007: a cancelled reservation leaves every existing rule,
// one test per rule. Rules 1-5 read the released intervals (research R9); rule 6 reads the
// stored status.
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z"); // Monday
const DATE = "2026-11-14"; // Saturday
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

let app: Express;
let token = "";
let notifier: Notifier | undefined;

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seedStaff();
  await seedRestaurant({ tables: [{ name: "Solo", capacity: 4 }], schedule: { saturday: [DINNER] } });
  app = buildTestApp({
    now: NOW,
    jwtExpiresIn: "30d",
    emailSender: new FakeEmailSender("ok"),
    onNotifier: (n) => {
      notifier = n;
    },
  });
  token = await loginAs(app);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Created = { id: string; secretCode: string; table: { name: string } };
type Cancel = "guest" | "staff";

async function book(over: Record<string, unknown> = {}): Promise<Created> {
  const res = await reserveAs(app, { date: DATE, time: "18:00", ...over });
  expect(res.status).toBe(201);
  return res.body as Created;
}

async function cancel(by: Cancel, r: Created): Promise<void> {
  const res = by === "guest" ? await cancelWithCode(app, r.secretCode) : await cancelAsStaff(app, r.id, token);
  expect(res.status).toBe(200);
}

const staff = (method: "post" | "put" | "patch" | "delete", path: string) =>
  kept(app)[method](path).set("Authorization", `Bearer ${token}`);

const availability = (time: string) =>
  kept(app).get("/availability").query({ date: DATE, time, partySize: "2" });
const times = () => kept(app).get("/availability/times").query({ date: DATE, partySize: "2" });

describe.each<Cancel>(["guest", "staff"])("cancelled by %s leaves every rule", (by) => {
  it("(1) availability lists the freed table again", async () => {
    const r = await book();
    expect((await availability("18:00")).body).toMatchObject({ available: false });
    await cancel(by, r);
    expect((await availability("18:00")).body).toMatchObject({ available: true });
  });

  it("(2) the bookable-times list includes the freed time again", async () => {
    const r = await book();
    const before = (await times()).body as { periods: { times: string[] }[] };
    expect(before.periods.flatMap((p) => p.times)).not.toContain("18:00");
    await cancel(by, r);
    const after = (await times()).body as { periods: { times: string[] }[] };
    expect(after.periods.flatMap((p) => p.times)).toContain("18:00");
  });

  it("(3) assignment: the only suitable table, held by the cancelled reservation, is assigned again", async () => {
    const r = await book({ email: "a@mail.com" });
    await cancel(by, r);
    const next = await reserveAs(app, { date: DATE, time: "18:00", email: "b@mail.com", name: "Bob" });
    expect(next.status).toBe(201);
    expect((next.body as Created).table.name).toBe("Solo");
  });

  it("(4) duplicate check: the same email can book an overlapping time", async () => {
    const r = await book({ email: "ana@mail.com" });
    await cancel(by, r);
    const again = await reserveAs(app, { date: DATE, time: "19:00", email: "ana@mail.com" });
    expect(again.status).toBe(201);
  });

  it("(5) table removal: a table whose only upcoming reservation was cancelled can be removed", async () => {
    const r = await book();
    const solo = await kept(app).get("/tables").set("Authorization", `Bearer ${token}`);
    const id = (solo.body as { id: string }[])[0]!.id;
    expectError(await staff("delete", `/tables/${id}`), 409, "CONFLICT");
    await cancel(by, r);
    expect((await staff("delete", `/tables/${id}`)).status).toBe(204);
  });

  it("(7) SC-007: the record stays stored with its details, table, status and who cancelled", async () => {
    const r = await book({ name: "Ana Guest", email: "ana@mail.com" });
    const before = await Reservation.findById(r.id).lean();
    await cancel(by, r);
    await notifier?.idle();
    const after = await Reservation.findById(r.id).lean();
    expect(after?.status).toBe("cancelled");
    expect(after?.cancelledBy).toBe(by);
    expect(after?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    expect(String(after?.tableId)).toBe(String(before?.tableId));
    expect(after).toMatchObject({
      guestName: "Ana Guest",
      guestEmail: "ana@mail.com",
      date: DATE,
      startTime: "18:00",
      endTime: "20:00",
      partySize: 2,
    });
  });
});

describe("(6) affected-reservation lists ignore cancelled reservations", () => {
  type Listed = { affectedReservations: { id: string }[] };
  const idsOf = (res: { body: unknown }) => (res.body as Listed).affectedReservations.map((a) => a.id);

  it.each<Cancel>(["guest", "staff"])(
    "after a %s cancellation a schedule change, a closed date and a capacity reduction do not list it, while a confirmed one is listed",
    async (by) => {
      const cancelled = await book({ email: "a@mail.com", time: "18:00" });
      const kept1 = await book({ email: "b@mail.com", time: "21:00" });
      await cancel(by, cancelled);

      const tables = await kept(app).get("/tables").set("Authorization", `Bearer ${token}`);
      const tableId = (tables.body as { id: string }[])[0]!.id;

      const schedule = await staff("put", "/schedule").send({ days: [{ day: "monday", periods: [DINNER] }] });
      expect(schedule.status).toBe(200);
      expect(idsOf(schedule)).toEqual([kept1.id]);

      const closed = await staff("post", "/closed-dates").send({ date: DATE });
      expect(closed.status).toBe(201);
      expect(idsOf(closed)).toEqual([kept1.id]);

      const capacity = await staff("patch", `/tables/${tableId}`).send({ capacity: 1 });
      expect(capacity.status).toBe(200);
      expect(idsOf(capacity)).toEqual([kept1.id]);
    },
  );
});
