import { createHash } from "node:crypto";
import type { Express } from "express";
import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { fixedClock } from "../../src/shared/clock.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FAKE_FAILURE_ADDRESS, FAKE_FAILURE_MESSAGE, FakeEmailSender } from "../helpers/fake-email-sender.js";
import { kept } from "../helpers/keep-alive.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, US1: every successful POST /reservations hands exactly one confirmation email
// to the sender, without ever delaying or changing the response.
useTestDatabase();

// "Now" is Monday 2026-11-09 10:00 UTC. These Saturdays have dinner service; 2026-11-21 is closed.
const NOW = new Date("2026-11-09T10:00:00Z");
const SATURDAYS = ["2026-11-14", "2026-11-28", "2026-12-05", "2026-12-12"];
const CLOSED = "2026-11-21";
const LINK_BASE = "http://localhost:5173/cancel";

let errorSpy: MockInstance<typeof console.error>;
let logSpy: MockInstance<typeof console.log>;

beforeEach(async () => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await seedRestaurant({
    tables: [
      { name: "Window-2", capacity: 2 },
      { name: "Window-4", capacity: 4 },
      { name: "Window-6", capacity: 6 },
    ],
    schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
    closedDates: [CLOSED],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Created = { id: string; secretCode: string; table: { name: string } };

type Harness = { app: Express; sender: FakeEmailSender; idle: () => Promise<void> };

function harness(mode: "ok" | "fail" | "slow" | "never" = "ok", emailTimeoutMs?: number): Harness {
  const sender = new FakeEmailSender(mode, 2000);
  let notifier: Notifier | undefined;
  const app = buildTestApp({
    now: NOW,
    emailSender: sender,
    onNotifier: (n) => {
      notifier = n;
    },
    ...(emailTimeoutMs !== undefined && { emailTimeoutMs }),
  });
  return { app, sender, idle: () => notifier?.idle() ?? Promise.resolve() };
}

const emailFailedLines = () =>
  errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"email_failed"'));

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function clearReservations() {
  await Promise.all([Reservation.deleteMany({}), TableDay.deleteMany({}), GuestDay.deleteMany({})]);
}

describe("US1: confirmation email", () => {
  it("SC-001: 10 distinct reservations produce exactly one correct email each", async () => {
    const { app, sender, idle } = harness();
    const created: { body: Created; email: string; name: string; date: string }[] = [];

    for (let i = 0; i < 10; i++) {
      const date = SATURDAYS[Math.floor(i / 3)] as string; // 3 per day: one per table
      const email = `Guest${i}@Mail.com`;
      const name = `Guest Number${i}`;
      const res = await reserveAs(app, { date, time: "18:00", partySize: 2, name, email });
      expect(res.status).toBe(201);
      created.push({ body: res.body as Created, email: email.toLowerCase(), name, date });
    }
    await idle();

    expect(sender.sent).toHaveLength(10);
    for (const [i, { body, email, name, date }] of created.entries()) {
      const matching = sender.sent.filter((s) => s.message.to === email);
      expect(matching, `one email to ${email}`).toHaveLength(1);
      const { message, meta } = matching[0] as (typeof sender.sent)[number];
      expect(meta).toEqual({ kind: "confirmation", reservationId: body.id });
      expect(message.subject).toBe("Your reservation at La Mesa is confirmed");
      expect(message.text).toContain(name);
      expect(message.text).toContain(date);
      expect(message.text).toContain("18:00–20:00");
      expect(message.text).toContain("Party size: 2");
      expect(message.text).toContain(`${LINK_BASE}#code=${body.secretCode}`);
      expect(message.text).toContain(body.secretCode);
      const tableName = body.table.name;
      expect(tableName).toMatch(/^Window-/);
      expect(message.text).not.toContain(tableName);
      expect(message.text).not.toContain("Window");
      expect(message.subject).not.toContain(name);
      expect(i).toBeLessThan(10);
    }
    expect(emailFailedLines()).toHaveLength(0);
  });

  it("FR-005: refused requests send nothing (validation, no availability, duplicate, invalid JSON)", async () => {
    const { app, sender, idle } = harness();

    expect((await reserveAs(app, { date: SATURDAYS[0], time: "18:00", name: "" })).status).toBe(400);
    expect((await reserveAs(app, { date: CLOSED, time: "18:00" })).status).toBe(409); // closed date
    const badJson = await kept(app).post("/reservations").set("Content-Type", "application/json").send("{bad");
    expect(badJson.status).toBe(400);
    await idle();
    expect(sender.sent).toHaveLength(0);

    const ok = await reserveAs(app, { date: SATURDAYS[0], time: "18:00", email: "ana@mail.com" });
    expect(ok.status).toBe(201);
    const duplicate = await reserveAs(app, { date: SATURDAYS[0], time: "19:00", email: "ana@mail.com" });
    expect(duplicate.status).toBe(409);
    await idle();
    expect(sender.sent).toHaveLength(1); // only the successful one
  });

  it("SC-002: a failing sender changes neither the response nor the stored reservation, and is logged once", async () => {
    const input = { date: SATURDAYS[0], time: "18:00", partySize: 2, name: "Jane Roe", email: FAKE_FAILURE_ADDRESS };

    const working = harness("ok");
    const okRes = await reserveAs(working.app, input);
    await working.idle();
    expect(okRes.status).toBe(201);
    await clearReservations();

    const failing = harness("fail");
    const failRes = await reserveAs(failing.app, input);
    await failing.idle();

    expect(failRes.status).toBe(okRes.status);
    const strip = (b: Record<string, unknown>) => ({ ...b, id: undefined, secretCode: undefined });
    expect(strip(failRes.body as Record<string, unknown>)).toEqual(strip(okRes.body as Record<string, unknown>));
    expect(failRes.headers["cache-control"]).toBe("no-store");

    const stored = await Reservation.findById((failRes.body as { id: string }).id).lean();
    expect(stored?.status).toBe("confirmed");

    const lines = emailFailedLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as string;
    expect(JSON.parse(line)).toMatchObject({
      event: "email_failed",
      kind: "confirmation",
      reservationId: (failRes.body as { id: string }).id,
      reason: "EENVELOPE",
    });
    const code = (failRes.body as { secretCode: string }).secretCode;
    for (const secret of [code, FAKE_FAILURE_ADDRESS, "jane", "Jane Roe", FAKE_FAILURE_MESSAGE]) {
      expect(line).not.toContain(secret);
    }
  });

  it("SC-010: a slow sender does not delay the response; a sender that never settles is abandoned and logged as EmailTimeout", async () => {
    const slow = harness("slow"); // 2 s per email
    const started = performance.now();
    const res = await reserveAs(slow.app, { date: SATURDAYS[0], time: "18:00" });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(201);
    expect(elapsed).toBeLessThan(1000);
    expect(slow.sender.sent).toHaveLength(0); // still in flight when the response arrived
    await slow.idle();
    expect(slow.sender.sent).toHaveLength(1);
    expect(emailFailedLines()).toHaveLength(0);
    await clearReservations();

    const never = harness("never", 200);
    const res2 = await reserveAs(never.app, { date: SATURDAYS[0], time: "18:00" });
    expect(res2.status).toBe(201);
    await never.idle(); // resolves after the 200 ms limit
    const lines = emailFailedLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ event: "email_failed", kind: "confirmation", reason: "EmailTimeout" });
  });

  it("with no email transport configured the skip is logged and creation works", async () => {
    const config = loadConfig({
      MONGODB_URI: "mongodb://unused-in-tests",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
      RESTAURANT_TIME_ZONE: "UTC",
    });
    expect(config.SMTP_URL).toBeUndefined();
    let notifier: Notifier | undefined;
    const app = createApp({
      config,
      clock: fixedClock(NOW),
      onNotifier: (n) => {
        notifier = n;
      },
    });

    const res = await reserveAs(app, { date: SATURDAYS[0], time: "18:00" });
    expect(res.status).toBe(201);
    await notifier?.idle();

    const skipped = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"email_skipped"'));
    expect(skipped).toHaveLength(1);
    expect(JSON.parse(skipped[0] as string)).toMatchObject({
      event: "email_skipped",
      kind: "confirmation",
      reservationId: (res.body as { id: string }).id,
    });
    expect(skipped[0]).not.toContain((res.body as { secretCode: string }).secretCode);
    expect(emailFailedLines()).toHaveLength(0);
  });

  it("the code is stored only hashed and no later response returns it", async () => {
    const { app, sender, idle } = harness();
    const res = await reserveAs(app, { date: SATURDAYS[0], time: "18:00", email: "ana@mail.com" });
    await idle();
    const { id, secretCode } = res.body as { id: string; secretCode: string };

    const raw = await Reservation.collection.findOne({ _id: new Types.ObjectId(id) });
    expect(raw?.["secretCodeHash"]).toBe(sha256(secretCode));
    expect(JSON.stringify(raw)).not.toContain(secretCode);
    expect(await Reservation.findById(id).lean()).not.toHaveProperty("secretCodeHash");

    // A later request (a refused duplicate) does not echo the code either.
    const again = await reserveAs(app, { date: SATURDAYS[0], time: "18:00", email: "ana@mail.com" });
    expect(again.status).toBe(409);
    expect(again.text).not.toContain(secretCode);
    // The email is the only place besides the creation response that carries it.
    expect(sender.lastCode()).toBe(secretCode);
  });
});
