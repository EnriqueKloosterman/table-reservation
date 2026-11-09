import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelAsStaff, cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { FAKE_FAILURE_ADDRESS, FakeEmailSender } from "../helpers/fake-email-sender.js";
import { kept } from "../helpers/keep-alive.js";
import { loginAs } from "../helpers/login-as.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { seedStaff } from "../helpers/seed-staff.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, US3: staff cancel an upcoming reservation by id (bearer token required).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z"); // Monday
const DATE = "2026-11-14"; // Saturday
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

let errorSpy: MockInstance<typeof console.error>;
let token = "";

beforeEach(async () => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seedStaff();
  await seedRestaurant({
    tables: [
      { name: "Window-1", capacity: 2 },
      { name: "Window-2", capacity: 2 },
    ],
    schedule: { saturday: [DINNER] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Harness = { app: Express; sender: FakeEmailSender; idle: () => Promise<void> };

function harness(now: Date | (() => Date) = NOW): Harness {
  const sender = new FakeEmailSender("ok");
  let notifier: Notifier | undefined;
  const app = buildTestApp({
    now,
    emailSender: sender,
    jwtExpiresIn: "30d",
    onNotifier: (n) => {
      notifier = n;
    },
  });
  return { app, sender, idle: () => notifier?.idle() ?? Promise.resolve() };
}

type Created = { id: string; secretCode: string; table: { name: string } };

async function create(app: Express, over: Record<string, unknown> = {}): Promise<Created> {
  const res = await reserveAs(app, { date: DATE, time: "18:00", ...over });
  expect(res.status).toBe(201);
  return res.body as Created;
}

const cancellationsTo = (sender: FakeEmailSender, id: string) =>
  sender.sent.filter((s) => s.meta?.kind === "cancellation" && s.meta.reservationId === id);

async function holds(id: string): Promise<number> {
  return (
    (await TableDay.countDocuments({ "intervals.reservationId": id })) +
    (await GuestDay.countDocuments({ "intervals.reservationId": id }))
  );
}

describe("US3: staff cancellation", () => {
  it("cancels an upcoming reservation: same body shape, no-store, cancelledBy staff, resources freed, one email", async () => {
    const { app, sender, idle } = harness();
    token = await loginAs(app);
    const created = await create(app, { name: "Ana Guest", email: "ana@mail.com", phone: "+34 600 111 222" });
    await idle();

    const res = await cancelAsStaff(app, created.id, token);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      id: created.id,
      status: "cancelled",
      date: DATE,
      startTime: "18:00",
      endTime: "20:00",
      partySize: 2,
      cancelledAt: NOW.toISOString(),
    });
    for (const secret of [created.secretCode, created.table.name, "ana@mail.com", "+34 600 111 222", "Ana"]) {
      expect(res.text).not.toContain(secret);
    }

    const stored = await Reservation.findById(created.id).lean();
    expect(stored?.status).toBe("cancelled");
    expect(stored?.cancelledBy).toBe("staff");
    expect(stored?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    expect(await holds(created.id)).toBe(0);

    // The freed slot is bookable again, also by the same guest.
    const again = await reserveAs(app, { date: DATE, time: "18:00", email: "ana@mail.com", name: "Ana Guest" });
    expect(again.status).toBe(201);

    await idle();
    const sent = cancellationsTo(sender, created.id);
    expect(sent).toHaveLength(1);
    const { message } = sent[0] as (typeof sent)[number];
    expect(message.to).toBe("ana@mail.com");
    expect(message.text).toContain("The restaurant cancelled");
    expect(message.text).not.toContain("You cancelled");
    expect(message.text).not.toContain(created.secretCode);
    expect(message.text).not.toContain("#code=");
    expect(message.text).not.toMatch(/https?:\/\//);
    expect(message.text).not.toContain("Window");
  });

  describe("SC-008: authentication comes first", () => {
    it("no token, a malformed token and an expired token are refused with 401 and change nothing", async () => {
      let current = NOW;
      const { app, idle } = harness(() => new Date(current.getTime()));
      token = await loginAs(app);
      const created = await create(app);
      await idle();

      expectError(await cancelAsStaff(app, created.id), 401, "AUTHENTICATION_REQUIRED");
      expectError(await cancelAsStaff(app, created.id, "not-a-token"), 401, "AUTHENTICATION_REQUIRED");

      current = new Date(NOW.getTime() + 31 * 24 * 3600_000); // the token lasts 30 days
      expectError(await cancelAsStaff(app, created.id, token), 401, "AUTHENTICATION_REQUIRED");

      expect((await Reservation.findById(created.id).lean())?.status).toBe("confirmed");
      expect(await holds(created.id)).toBeGreaterThan(0);
    });

    it("auth is checked before the id: an unknown or malformed id without a token is 401, not 404", async () => {
      const { app } = harness();
      expectError(await cancelAsStaff(app, "6740c0ffee0123456789abcd"), 401, "AUTHENTICATION_REQUIRED");
      expectError(await cancelAsStaff(app, "abc"), 401, "AUTHENTICATION_REQUIRED");
    });
  });

  it("started, ended and already-cancelled reservations answer 409 and stay unchanged, with no email", async () => {
    let current = NOW;
    const { app, sender, idle } = harness(() => new Date(current.getTime()));
    token = await loginAs(app);
    const started = await create(app, { email: "a@mail.com", time: "18:00" });
    const ended = await create(app, { email: "b@mail.com", time: "18:00" });
    const cancelled = await create(app, { email: "c@mail.com", time: "21:00" });
    await idle();
    expect((await cancelAsStaff(app, cancelled.id, token)).status).toBe(200);
    await idle();
    const emailsBefore = sender.sent.length;

    // Restaurant-local 18:00–20:00 on 2026-11-14 is 17:00–19:00 UTC (winter time).
    const startedRecord = await Reservation.findById(started.id).lean();
    current = new Date(startedRecord!.startAt.getTime() + 30 * 60_000); // started, not yet ended
    expectError(await cancelAsStaff(app, started.id, token), 409, "CANNOT_CANCEL");
    current = new Date(startedRecord!.endAt.getTime() + 60_000); // ended
    expectError(await cancelAsStaff(app, ended.id, token), 409, "CANNOT_CANCEL");
    expectError(await cancelAsStaff(app, cancelled.id, token), 409, "ALREADY_CANCELLED");

    await idle();
    expect(sender.sent).toHaveLength(emailsBefore);
    expect((await Reservation.findById(started.id).lean())?.status).toBe("confirmed");
    expect((await Reservation.findById(ended.id).lean())?.status).toBe("confirmed");
  });

  it("a malformed id and an unknown well-formed id answer 404 with the same message as the guest path", async () => {
    const { app } = harness();
    token = await loginAs(app);
    const guest = await cancelWithCode(app, "no-such-code");
    expect(expectError(guest, 404, "NOT_FOUND").message).toBe("Reservation not found");

    for (const id of ["abc", "0123456789abcdef0123456", "6740c0ffee0123456789abcd"]) {
      const res = await cancelAsStaff(app, id, token);
      expect(expectError(res, 404, "NOT_FOUND").message, id).toBe("Reservation not found");
      expect(res.body, id).toEqual(guest.body);
    }
  });

  it("ignores a body sent with the request", async () => {
    const { app, idle } = harness();
    token = await loginAs(app);
    const created = await create(app);
    await idle();
    const res = await kept(app)
      .post(`/reservations/${created.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "ignored", nonsense: true });
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe(created.id);
  });

  it("FR-016: cancelling each affected reservation completes the workflow; later changes no longer list them", async () => {
    const { app, idle } = harness();
    token = await loginAs(app);
    const a = await create(app, { email: "a@mail.com", time: "18:00" });
    const b = await create(app, { email: "b@mail.com", time: "21:00" });
    await idle();

    const closed = await kept(app).post("/closed-dates").set("Authorization", `Bearer ${token}`).send({ date: DATE });
    expect(closed.status).toBe(201);
    const listed = (closed.body as { affectedReservations: { id: string }[] }).affectedReservations.map((r) => r.id);
    expect([...listed].sort()).toEqual([a.id, b.id].sort());

    for (const id of listed) expect((await cancelAsStaff(app, id, token)).status).toBe(200);
    await idle();

    // A schedule change that would contradict them (no Saturday service) lists nothing now.
    const schedule = await kept(app)
      .put("/schedule")
      .set("Authorization", `Bearer ${token}`)
      .send({ days: [{ day: "monday", periods: [DINNER] }] });
    expect(schedule.status).toBe(200);
    expect((schedule.body as { affectedReservations: unknown[] }).affectedReservations).toEqual([]);
  });

  it("a failing sender does not change the 200 and logs one email_failed line", async () => {
    const { app, sender, idle } = harness();
    token = await loginAs(app);
    const created = await create(app, { email: FAKE_FAILURE_ADDRESS });
    await idle();
    sender.setMode("fail");
    errorSpy.mockClear();

    const res = await cancelAsStaff(app, created.id, token);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("cancelled");
    await idle();
    const failures = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("email_failed"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).not.toContain(FAKE_FAILURE_ADDRESS);
    expect(failures[0]).not.toContain(created.secretCode);
  });

  it("guest then staff on the same reservation: staff gets ALREADY_CANCELLED and one email is sent in total", async () => {
    const { app, sender, idle } = harness();
    token = await loginAs(app);
    const created = await create(app);
    await idle();
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
    expectError(await cancelAsStaff(app, created.id, token), 409, "ALREADY_CANCELLED");
    await idle();
    expect(cancellationsTo(sender, created.id)).toHaveLength(1);
    expect((await Reservation.findById(created.id).lean())?.cancelledBy).toBe("guest");
  });

  it("repeating the cancellation of A leaves a later reservation B of the same guest at the same time untouched", async () => {
    const { app, idle } = harness();
    token = await loginAs(app);
    const a = await create(app, { email: "ana@mail.com", time: "18:00" });
    await idle();
    expect((await cancelAsStaff(app, a.id, token)).status).toBe(200);
    const b = await create(app, { email: "ana@mail.com", time: "18:00" }); // allowed once A is cancelled
    expectError(await cancelAsStaff(app, a.id, token), 409, "ALREADY_CANCELLED");

    expect((await Reservation.findById(b.id).lean())?.status).toBe("confirmed");
    expect(await holds(b.id)).toBeGreaterThan(0);
  });
});
