import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { fixedClock } from "../../src/shared/clock.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Spec Assumptions, FR-003, FR-004, Constitution V: an unreachable mail server only produces a
// logged failure. This uses the REAL Nodemailer sender against a closed local port; no SMTP
// server is needed (nothing listens on port 1).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const GUEST = { name: "Jane Roe", email: "jane.roe@example.test" };

let errorSpy: MockInstance<typeof console.error>;

beforeEach(async () => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  await seedRestaurant({
    tables: [{ name: "Window-4", capacity: 4 }],
    schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("confirmation email through an unreachable SMTP server", () => {
  it("starts, answers 201 quickly, stores the reservation and logs one safe failure line", async () => {
    const config = loadConfig({
      MONGODB_URI: "mongodb://unused-in-tests",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
      RESTAURANT_TIME_ZONE: "UTC",
      SMTP_URL: "smtp://user:s3cret@127.0.0.1:1",
      EMAIL_FROM: "noreply@resto.test",
      EMAIL_TIMEOUT_MS: "2000",
    });
    let notifier: Notifier | undefined;
    // Building the app must neither connect nor throw.
    const app = createApp({
      config,
      clock: fixedClock(NOW),
      onNotifier: (n) => {
        notifier = n;
      },
    });

    const started = performance.now();
    const res = await reserveAs(app, { date: "2026-11-14", time: "18:00", partySize: 2, ...GUEST });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(201);
    expect(elapsed).toBeLessThan(1000);

    await notifier?.idle();

    const { id, secretCode } = res.body as { id: string; secretCode: string };
    const lines = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"email_failed"'));
    expect(lines).toHaveLength(1);
    const line = lines[0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({ event: "email_failed", kind: "confirmation", reservationId: id });
    expect(typeof parsed["reason"]).toBe("string");
    expect((parsed["reason"] as string).length).toBeGreaterThan(0);

    const local = GUEST.email.split("@")[0] as string;
    for (const secret of [secretCode, GUEST.email, local, "example.test", GUEST.name, "Jane", "s3cret", "127.0.0.1"]) {
      expect(line, `the log line must not contain ${secret === secretCode ? "the code" : secret}`).not.toContain(secret);
    }

    expect((await Reservation.findById(id).lean())?.status).toBe("confirmed");
  });
});
