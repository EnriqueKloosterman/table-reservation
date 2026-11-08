import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { releaseInterval } from "../../src/modules/reservations/interval-claims.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { FakeEmailSender } from "../helpers/fake-email-sender.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, SC-005 / FR-015 / research R8: concurrent cancellations and cancel vs reserve.
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const DATE = "2026-11-14";

let sender: FakeEmailSender;
let notifier: Notifier | undefined;
let gate: Promise<void> | undefined;

function build() {
  sender = new FakeEmailSender("ok");
  return buildTestApp({
    now: NOW,
    emailSender: sender,
    onNotifier: (n) => {
      notifier = n;
    },
    // Optionally holds back every release until `gate` settles (set per test).
    reservationOps: {
      release: async (model, key, reservationId) => {
        await gate;
        await releaseInterval(model, key, reservationId);
      },
    },
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  gate = undefined;
  await seedRestaurant({
    tables: [{ name: "T1", capacity: 2 }],
    schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const holds = async (id: string) =>
  (await TableDay.countDocuments({ "intervals.reservationId": new Types.ObjectId(id) })) +
  (await GuestDay.countDocuments({ "intervals.reservationId": new Types.ObjectId(id) }));

describe("SC-005: 20 simultaneous cancellations", () => {
  it("over 50 rounds exactly one succeeds, one email is sent and no interval is left", async () => {
    const app = build();
    for (let round = 0; round < 50; round++) {
      const created = await reserveAs(app, { date: DATE, time: "18:00", email: `round${round}@mail.com` });
      expect(created.status, `round ${round} create`).toBe(201);
      const { id, secretCode } = created.body as { id: string; secretCode: string };

      const results = await Promise.all(Array.from({ length: 20 }, () => cancelWithCode(app, secretCode)));
      await notifier?.idle();

      const ok = results.filter((r) => r.status === 200);
      const already = results.filter((r) => r.status === 409);
      expect(ok, `round ${round}: one 200`).toHaveLength(1);
      expect(already, `round ${round}: nineteen 409`).toHaveLength(19);
      for (const r of already) expectError(r, 409, "ALREADY_CANCELLED");

      const emails = sender.sent.filter((s) => s.meta?.kind === "cancellation" && s.meta.reservationId === id);
      expect(emails, `round ${round}: one email`).toHaveLength(1);
      expect(await holds(id), `round ${round}: no interval left`).toBe(0);
      expect((await Reservation.findById(id).lean())?.status).toBe("cancelled");
    }
  }, 180_000);
});

describe("cancel vs reserve (research R8)", () => {
  it("while a cancellation has flipped the status but not released, the slot stays hidden: never a double booking", async () => {
    const app = build();
    const a = (await reserveAs(app, { date: DATE, time: "18:00", email: "a@mail.com" })).body as {
      id: string;
      secretCode: string;
    };

    let open!: () => void;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const cancelling = cancelWithCode(app, a.secretCode).then((r) => r); // starts now, blocked at the releases
    for (let i = 0; i < 50 && (await Reservation.findById(a.id).lean())?.status !== "cancelled"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await Reservation.findById(a.id).lean())?.status).toBe("cancelled");
    expect(await holds(a.id)).toBeGreaterThan(0); // still holding the table

    // A new request for the same slot sees it as held: refused, not double-assigned.
    const blocked = await reserveAs(app, { date: DATE, time: "18:00", email: "b@mail.com" });
    expectError(blocked, 409, "NO_AVAILABILITY");

    open();
    expect((await cancelling).status).toBe(200);
    const free = await reserveAs(app, { date: DATE, time: "18:00", email: "b@mail.com" });
    expect(free.status).toBe(201);
  });

  it("racing a cancellation against a booking of the same slot never leaves two confirmed reservations on one table", async () => {
    const app = build();
    for (let round = 0; round < 25; round++) {
      await Promise.all([Reservation.deleteMany({}), TableDay.deleteMany({}), GuestDay.deleteMany({})]);
      const a = (await reserveAs(app, { date: DATE, time: "18:00", email: "a@mail.com" })).body as {
        id: string;
        secretCode: string;
      };

      const [cancelRes, reserveRes] = await Promise.all([
        cancelWithCode(app, a.secretCode),
        reserveAs(app, { date: DATE, time: "18:00", email: "b@mail.com" }),
      ]);
      await notifier?.idle();

      expect(cancelRes.status, `round ${round}`).toBe(200);
      expect([201, 409], `round ${round}`).toContain(reserveRes.status);

      const confirmed = await Reservation.find({ status: "confirmed", date: DATE }).lean();
      const byTable = new Map<string, number>();
      for (const r of confirmed) byTable.set(String(r.tableId), (byTable.get(String(r.tableId)) ?? 0) + 1);
      for (const [table, n] of byTable) expect(n, `round ${round}: confirmed on table ${table}`).toBeLessThanOrEqual(1);
      expect(await holds(a.id)).toBe(0);
    }
  }, 120_000);
});
