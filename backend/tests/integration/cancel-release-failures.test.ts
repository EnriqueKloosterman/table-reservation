import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { releaseInterval, type ClaimModel } from "../../src/modules/reservations/interval-claims.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { FakeEmailSender } from "../helpers/fake-email-sender.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, FR-008 / research R3: a cancellation that cannot release everything never
// reports success, never sends the email, and is repaired by presenting the code again.
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const DATE = "2026-11-14";

/** How many more releases of each calendar fail, and how many were attempted. */
const plan = { table: 0, guest: 0 };
const attempts = { table: 0, guest: 0 };

let sender: FakeEmailSender;
let notifier: Notifier | undefined;
let errorSpy: MockInstance<typeof console.error>;

function build() {
  sender = new FakeEmailSender("ok");
  return buildTestApp({
    now: NOW,
    emailSender: sender,
    onNotifier: (n) => {
      notifier = n;
    },
    reservationOps: {
      release: async (model: ClaimModel, key: Record<string, unknown>, reservationId: Types.ObjectId) => {
        const kind = model === TableDay ? "table" : "guest";
        attempts[kind] += 1;
        if (plan[kind] > 0) {
          plan[kind] -= 1;
          throw new Error("simulated database failure");
        }
        await releaseInterval(model, key, reservationId);
      },
    },
  });
}

beforeEach(async () => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  plan.table = 0;
  plan.guest = 0;
  attempts.table = 0;
  attempts.guest = 0;
  await seedRestaurant({
    tables: [{ name: "T1", capacity: 2 }],
    schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const app = build();
  const res = await reserveAs(app, { date: DATE, time: "18:00", name: "Ana Guest", email: "ana@mail.com" });
  expect(res.status).toBe(201);
  await notifier?.idle();
  attempts.table = 0;
  attempts.guest = 0;
  const { id, secretCode } = res.body as { id: string; secretCode: string };
  return { app, id, code: secretCode };
}

const held = async (id: string) => ({
  table: await TableDay.countDocuments({ "intervals.reservationId": new Types.ObjectId(id) }),
  guest: await GuestDay.countDocuments({ "intervals.reservationId": new Types.ObjectId(id) }),
});
const cancellationEmails = () => sender.sent.filter((s) => s.meta?.kind === "cancellation");

describe("release failures during a cancellation", () => {
  it("(a) one transient failure succeeds on the retry: 200 and one email", async () => {
    const { app, id, code } = await setup();
    plan.table = 1;

    const res = await cancelWithCode(app, code);
    await notifier?.idle();

    expect(res.status).toBe(200);
    expect(attempts.table).toBe(2);
    expect(await held(id)).toEqual({ table: 0, guest: 0 });
    expect(cancellationEmails()).toHaveLength(1);
  });

  it("(b) a persistent table-release failure: 500, still cancelled, no email, the guest release was still attempted", async () => {
    const { app, id, code } = await setup();
    plan.table = Infinity;

    const res = await cancelWithCode(app, code);
    await notifier?.idle();

    const error = expectError(res, 500, "INTERNAL_ERROR");
    expect(error.message).toBe("An unexpected error occurred");
    expect((await Reservation.findById(id).lean())?.status).toBe("cancelled");
    expect(attempts.table).toBe(2); // the attempt and its single retry
    expect(attempts.guest).toBeGreaterThanOrEqual(1);
    expect(await held(id)).toEqual({ table: 1, guest: 0 });
    expect(cancellationEmails()).toHaveLength(0);
  });

  it("(c) a persistent guest-release failure behaves the same", async () => {
    const { app, id, code } = await setup();
    plan.guest = Infinity;

    const res = await cancelWithCode(app, code);
    await notifier?.idle();

    expectError(res, 500, "INTERNAL_ERROR");
    expect((await Reservation.findById(id).lean())?.status).toBe("cancelled");
    expect(attempts.guest).toBe(2);
    expect(attempts.table).toBeGreaterThanOrEqual(1);
    expect(await held(id)).toEqual({ table: 0, guest: 1 });
    expect(cancellationEmails()).toHaveLength(0);
  });

  it("(d) presenting the code again with healthy operations repairs the release: ALREADY_CANCELLED, no email", async () => {
    const { app, id, code } = await setup();
    plan.table = Infinity;
    expectError(await cancelWithCode(app, code), 500, "INTERNAL_ERROR");
    expect(await held(id)).toEqual({ table: 1, guest: 0 });

    plan.table = 0; // the database is healthy again
    expectError(await cancelWithCode(app, code), 409, "ALREADY_CANCELLED");
    await notifier?.idle();

    expect(await held(id)).toEqual({ table: 0, guest: 0 });
    expect(cancellationEmails()).toHaveLength(0);
    const stored = await Reservation.findById(id).lean();
    expect(stored?.status).toBe("cancelled");
    expect(stored?.cancelledBy).toBe("guest");
  });

  it("(e) a repair that fails again is a 500 and still sends no email", async () => {
    const { app, id, code } = await setup();
    plan.table = Infinity;
    expectError(await cancelWithCode(app, code), 500, "INTERNAL_ERROR");
    expectError(await cancelWithCode(app, code), 500, "INTERNAL_ERROR");
    await notifier?.idle();

    expect(await held(id)).toEqual({ table: 1, guest: 0 });
    expect(cancellationEmails()).toHaveLength(0);
    expect((await Reservation.findById(id).lean())?.status).toBe("cancelled");
  });

  it("(f) the log of a failed release has the reservation id and the error name only", async () => {
    const { app, id, code } = await setup();
    plan.table = Infinity;
    plan.guest = Infinity;
    errorSpy.mockClear();

    expectError(await cancelWithCode(app, code), 500, "INTERNAL_ERROR");

    const output = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(output).toContain(id);
    expect(output).toContain("Error"); // the error name
    for (const secret of [code, "ana@mail.com", "ana", "Ana Guest", "simulated database failure", "T1"]) {
      expect(output, `the log must not contain ${secret}`).not.toContain(secret);
    }
    // Two failed releases (table and guest): one line each, nothing else.
    expect(errorSpy.mock.calls).toHaveLength(2);
  });
});
