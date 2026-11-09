import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClosedDate } from "../../src/modules/closed-dates/closed-date.model.js";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { WeeklySchedule } from "../../src/modules/schedule/schedule.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { FakeEmailSender } from "../helpers/fake-email-sender.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, US2: when a reservation can be cancelled (FR-009, FR-010, FR-016, FR-021).
useTestDatabase();

const CREATED_AT = "2026-11-09T10:00:00Z";
const DATE = "2026-11-14"; // Saturday; the reservation is 18:00-20:00 UTC (time zone UTC)

type Created = { id: string; secretCode: string };

let clock: Date;
let sender: FakeEmailSender;
let notifier: Notifier | undefined;
let app: Express;

function build(bookingRules?: { minNoticeMinutes?: number }): Express {
  sender = new FakeEmailSender("ok");
  return buildTestApp({
    now: () => clock,
    emailSender: sender,
    onNotifier: (n) => {
      notifier = n;
    },
    ...(bookingRules && { bookingRules }),
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  clock = new Date(CREATED_AT);
  app = build();
  await seedRestaurant({
    tables: [
      { name: "T1", capacity: 2 },
      { name: "T2", capacity: 2 },
    ],
    schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function create(over: Record<string, unknown> = {}, target: Express = app): Promise<Created> {
  const res = await reserveAs(target, { date: DATE, time: "18:00", ...over });
  expect(res.status).toBe(201);
  return res.body as Created;
}

const cancellationEmails = () => sender.sent.filter((s) => s.meta?.kind === "cancellation");

describe("the start instant decides (FR-009)", () => {
  it.each([
    ["well before the start", "2026-11-09T10:00:00Z", 200],
    ["one millisecond before the start", "2026-11-14T17:59:59.999Z", 200],
    ["at exactly the start instant", "2026-11-14T18:00:00.000Z", 409],
    ["after it started", "2026-11-14T18:30:00Z", 409],
    ["at the end instant", "2026-11-14T20:00:00Z", 409],
    ["after it ended", "2026-11-20T09:00:00Z", 409],
  ])("%s", async (_label, nowIso, status) => {
    const created = await create();
    await notifier?.idle();
    clock = new Date(nowIso);

    const res = await cancelWithCode(app, created.secretCode);
    expect(res.status).toBe(status);
    await notifier?.idle();

    const stored = await Reservation.findById(created.id).lean();
    if (status === 200) {
      expect(stored?.status).toBe("cancelled");
      expect(cancellationEmails()).toHaveLength(1);
    } else {
      expectError(res, 409, "CANNOT_CANCEL");
      expect(stored?.status).toBe("confirmed");
      expect(stored?.cancelledAt).toBeNull();
      expect(stored?.cancelledBy).toBeNull();
      expect(cancellationEmails()).toHaveLength(0);
      expect(await TableDay.countDocuments({ "intervals.reservationId": created.id })).toBe(1); // still held
    }
  });

  it("an ended reservation whose table was later removed is CANNOT_CANCEL, not NOT_FOUND", async () => {
    const created = await create();
    const stored = await Reservation.findById(created.id).lean();
    await Table.updateOne({ _id: stored?.tableId }, { removed: true, removedAt: new Date(CREATED_AT) });
    clock = new Date("2026-11-20T09:00:00Z");

    expectError(await cancelWithCode(app, created.secretCode), 409, "CANNOT_CANCEL");
    expect((await Reservation.findById(created.id).lean())?.status).toBe("confirmed");
  });

  it("cancelled AND past its start is ALREADY_CANCELLED (FR-010 precedence)", async () => {
    const created = await create();
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
    clock = new Date("2026-11-20T09:00:00Z");

    expectError(await cancelWithCode(app, created.secretCode), 409, "ALREADY_CANCELLED");
    await notifier?.idle();
    expect(cancellationEmails()).toHaveLength(1);
  });
});

describe("no minimum notice for cancelling", () => {
  it("a reservation that starts in one minute can be cancelled, although it could not be created with the default notice", async () => {
    clock = new Date("2026-11-14T17:59:00Z");

    // The default 60-minute notice refuses it ...
    const refused = await reserveAs(app, { date: DATE, time: "18:00" });
    expectError(refused, 409, "NO_AVAILABILITY");

    // ... an app with no minimum notice accepts it, and it can then be cancelled at once.
    const noNotice = build({ minNoticeMinutes: 0 });
    const created = await create({}, noNotice);
    const res = await cancelWithCode(noNotice, created.secretCode);
    expect(res.status).toBe(200);
    expect((res.body as { cancelledAt: string }).cancelledAt).toBe("2026-11-14T17:59:00.000Z");
  });
});

describe("configuration changes do not block cancelling (FR-016)", () => {
  it("a reservation that now falls on a closed date is still cancellable", async () => {
    const created = await create();
    await ClosedDate.create({ date: DATE, reason: null });
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
  });

  it("a reservation that now falls outside the schedule is still cancellable", async () => {
    const created = await create();
    await seedRestaurant({ schedule: {} }); // no service on any day
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
  });

  it("a reservation whose table was reduced below the party size is still cancellable", async () => {
    const created = await create();
    const stored = await Reservation.findById(created.id).lean();
    await Table.updateOne({ _id: stored?.tableId }, { capacity: 1 });
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
  });
});

describe("cancelling touches nothing else (FR-021)", () => {
  it("leaves the same guest's other reservation, the other table, the schedule and the closed dates alone", async () => {
    await ClosedDate.create({ date: "2026-11-21", reason: "Holiday" });
    const a = await create({ email: "ana@mail.com", time: "18:00" });
    const b = await create({ email: "ana@mail.com", time: "21:00" }); // same guest, another time
    const c = await create({ email: "carl@mail.com", time: "18:00" }); // another guest, same time

    const snapshot = async () => ({
      tables: await Table.find({}).sort({ name: 1 }).lean(),
      schedule: await WeeklySchedule.find({}).lean(),
      closed: await ClosedDate.find({}).lean(),
      others: await Reservation.find({ _id: { $in: [b.id, c.id] } }).sort({ _id: 1 }).lean(),
      tableDays: await TableDay.find({}).sort({ tableId: 1 }).lean(),
      guestDays: await GuestDay.find({ email: { $in: ["ana@mail.com", "carl@mail.com"] } }).sort({ email: 1 }).lean(),
    });
    const before = await snapshot();

    expect((await cancelWithCode(app, a.secretCode)).status).toBe(200);
    const after = await snapshot();

    expect(after.tables).toEqual(before.tables);
    expect(after.schedule).toEqual(before.schedule);
    expect(after.closed).toEqual(before.closed);
    expect(after.others).toEqual(before.others);
    expect(after.others.map((r) => r.status)).toEqual(["confirmed", "confirmed"]);

    // Only A's two intervals disappeared; B's and C's are still held.
    const heldIds = (days: { intervals: { reservationId: unknown }[] }[]) =>
      days.flatMap((d) => d.intervals.map((i) => String(i.reservationId))).sort();
    expect(heldIds(after.tableDays)).toEqual([b.id, c.id].sort());
    expect(heldIds(after.guestDays)).toEqual([b.id, c.id].sort());
    expect(heldIds(before.tableDays)).toEqual([a.id, b.id, c.id].sort());
  });
});
