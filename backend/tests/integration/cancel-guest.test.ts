import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { cancelWithCode } from "../helpers/cancel-as.js";
import { expectError } from "../helpers/expect-error.js";
import { FAKE_FAILURE_ADDRESS, FakeEmailSender } from "../helpers/fake-email-sender.js";
import { kept } from "../helpers/keep-alive.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, US2: a guest cancels with the secret code (public, no sign-in).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const DATE = "2026-11-14";

let errorSpy: MockInstance<typeof console.error>;

beforeEach(async () => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seedRestaurant({
    tables: [
      { name: "Window-1", capacity: 2 },
      { name: "Window-2", capacity: 2 },
    ],
    schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Harness = { app: Express; sender: FakeEmailSender; idle: () => Promise<void> };

function harness(): Harness {
  const sender = new FakeEmailSender("ok");
  let notifier: Notifier | undefined;
  const app = buildTestApp({
    now: NOW,
    emailSender: sender,
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

async function intervalsOf(reservationId: string) {
  const tables = await TableDay.find({ "intervals.reservationId": reservationId }).lean();
  const guests = await GuestDay.find({ "intervals.reservationId": reservationId }).lean();
  return { tables: tables.length, guests: guests.length };
}

describe("US2: cancel with the secret code", () => {
  it("SC-003: create, read the code from the email, cancel; the time is immediately bookable again", async () => {
    const { app, sender, idle } = harness();
    const first = await create(app, { name: "Ana Guest", email: "ana@mail.com", phone: "+34 600 111 222" });
    await idle();
    const code = sender.lastCode();
    expect(code).toBe(first.secretCode);

    const res = await cancelWithCode(app, code);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body as object).sort()).toEqual([
      "cancelledAt",
      "date",
      "endTime",
      "id",
      "partySize",
      "startTime",
      "status",
    ]);
    expect(res.body).toEqual({
      id: first.id,
      status: "cancelled",
      date: DATE,
      startTime: "18:00",
      endTime: "20:00",
      partySize: 2,
      cancelledAt: NOW.toISOString(),
    });
    for (const secret of [code, first.table.name, "Window", "ana@mail.com", "+34 600 111 222", "Ana"]) {
      expect(res.text).not.toContain(secret);
    }
    expect(res.text).not.toMatch(/[0-9a-f]{64}/); // no hash either

    // The freed table is bookable by another guest at once ...
    const second = await reserveAs(app, { date: DATE, time: "18:00", name: "Bob", email: "bob@mail.com" });
    expect(second.status).toBe(201);
    expect((second.body as Created).table.name).toBe(first.table.name);
    // ... and the same email can book again, even an overlapping time.
    const again = await reserveAs(app, { date: DATE, time: "19:00", name: "Ana Guest", email: "ana@mail.com" });
    expect(again.status).toBe(201);
  });

  it("sends exactly one cancellation email: 'You cancelled', no code, no link, no table name", async () => {
    const { app, sender, idle } = harness();
    const created = await create(app, { name: "Ana Guest", email: "ana@mail.com" });
    await idle();
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
    await idle();

    const sent = cancellationsTo(sender, created.id);
    expect(sent).toHaveLength(1);
    const { message } = sent[0] as (typeof sent)[number];
    expect(message.to).toBe("ana@mail.com");
    expect(message.subject).toBe("Your reservation at La Mesa was cancelled");
    expect(message.text).toContain("You cancelled");
    expect(message.text).toContain("Ana Guest");
    expect(message.text).toContain("18:00–20:00");
    expect(message.text).not.toContain(created.secretCode);
    expect(message.text).not.toContain("#code=");
    expect(message.text).not.toMatch(/https?:\/\//);
    expect(message.text).not.toContain("Window");
    expect(sender.sent).toHaveLength(2); // the confirmation and the cancellation
  });

  it("keeps the record: details, table, status cancelled, cancelledAt and cancelledBy guest (FR-018)", async () => {
    const { app, idle } = harness();
    const created = await create(app, { name: "Ana Guest", email: "ana@mail.com" });
    const before = await Reservation.findById(created.id).lean();
    await idle();
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);

    const stored = await Reservation.findById(created.id).lean();
    expect(stored).toMatchObject({
      status: "cancelled",
      cancelledBy: "guest",
      tableId: before?.tableId,
      date: DATE,
      startTime: "18:00",
      endTime: "20:00",
      partySize: 2,
      guestName: "Ana Guest",
      guestEmail: "ana@mail.com",
    });
    expect(stored?.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    const table = await Table.findById(stored?.tableId).lean();
    expect(table?.name).toBe(created.table.name);
    expect(await intervalsOf(created.id)).toEqual({ tables: 0, guests: 0 });
  });

  it("repeating the request is ALREADY_CANCELLED: nothing changes and no second email", async () => {
    const { app, sender, idle } = harness();
    const created = await create(app);
    expect((await cancelWithCode(app, created.secretCode)).status).toBe(200);
    await idle();
    const stored = await Reservation.findById(created.id).lean();

    for (let i = 0; i < 3; i++) {
      expectError(await cancelWithCode(app, created.secretCode), 409, "ALREADY_CANCELLED");
    }
    await idle();
    expect(await Reservation.findById(created.id).lean()).toEqual(stored);
    expect(cancellationsTo(sender, created.id)).toHaveLength(1);
  });

  it("SC-004: every kind of bad code gets the identical 404", async () => {
    const { app, sender, idle } = harness();
    const created = await create(app);
    await idle();
    const bad = [
      "k3J9xQ7mV0aB4tYw2uHnR8dLzE5cFgS1pXoI6vMqTaU", // a plausible 43-char code that matches nothing
      "",
      "abc",
      "x".repeat(200),
      "../etc/passwd é ✓\n\t \u0000 %00 <script>",
      `${created.secretCode} `, // the real code plus a space: the code is used exactly as sent
      ` ${created.secretCode}`,
      created.secretCode.toUpperCase() === created.secretCode ? created.secretCode.toLowerCase() : created.secretCode.toUpperCase(),
    ];
    const responses = [];
    for (const code of bad) responses.push(await cancelWithCode(app, code));

    const first = responses[0] as (typeof responses)[number];
    const error = expectError(first, 404, "NOT_FOUND");
    expect(error.message).toBe("Reservation not found");
    expect(error.details).toBeUndefined();
    for (const [i, res] of responses.entries()) {
      expect(res.status, `case ${i}`).toBe(404);
      expect(res.body, `case ${i}`).toEqual(first.body);
    }
    expect((await Reservation.findById(created.id).lean())?.status).toBe("confirmed");
    await idle();
    expect(cancellationsTo(sender, created.id)).toHaveLength(0);
  });

  it("refuses malformed requests with 400 VALIDATION_ERROR before any lookup", async () => {
    const { app } = harness();
    const created = await create(app);
    const post = () => kept(app).post("/reservations/cancel");

    for (const body of [{}, { code: 1 }, { code: null }, { code: ["a"] }, { code: { a: 1 } }]) {
      expectError(await post().send(body), 400, "VALIDATION_ERROR");
    }
    // an unknown extra field is refused even when the code is real: nothing is cancelled
    const extra = expectError(await post().send({ code: created.secretCode, note: "hi" }), 400, "VALIDATION_ERROR");
    expect(extra.details).toEqual([{ field: "note", reason: "Unknown field" }]);
    // every offending field is reported at once
    const both = expectError(await post().send({ code: 1, note: "hi", other: 2 }), 400, "VALIDATION_ERROR");
    const fields = (both.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(["code", "note", "other"]);

    expectError(await post().set("Content-Type", "application/json").send("{bad"), 400, "VALIDATION_ERROR");
    expectError(await post().set("Content-Type", "text/plain").send(created.secretCode), 400, "VALIDATION_ERROR");

    expect((await Reservation.findById(created.id).lean())?.status).toBe("confirmed");
  });

  it("the code in a URL never cancels anything", async () => {
    const { app } = harness();
    const created = await create(app);
    const code = created.secretCode;

    const attempts = [
      await kept(app).post(`/reservations/cancel/${code}`),
      await kept(app).get(`/reservations/cancel?code=${code}`),
      await kept(app).post(`/reservations/${code}/cancel`), // no sign-in: refused (401) or unknown (404)
    ];
    expect([404, 404]).toEqual([attempts[0]?.status, attempts[1]?.status]);
    expect([401, 404]).toContain(attempts[2]?.status);

    // The query string is ignored: with no body the code is simply missing.
    expectError(await kept(app).post(`/reservations/cancel?code=${code}`).send({}), 400, "VALIDATION_ERROR");

    const stored = await Reservation.findById(created.id).lean();
    expect(stored?.status).toBe("confirmed");
    expect(stored?.cancelledAt).toBeNull();
  });

  it("a failing sender leaves the 200 identical and the reservation cancelled, with one logged failure", async () => {
    const input = { name: "Jane Roe", email: FAKE_FAILURE_ADDRESS };

    const working = harness();
    const a = await create(working.app, input);
    await working.idle();
    const okRes = await cancelWithCode(working.app, a.secretCode);
    await working.idle();
    expect(okRes.status).toBe(200);
    await Promise.all([Reservation.deleteMany({}), TableDay.deleteMany({}), GuestDay.deleteMany({})]);
    errorSpy.mockClear();

    const failing = harness();
    const b = await create(failing.app, input);
    await failing.idle();
    failing.sender.setMode("fail");
    const failRes = await cancelWithCode(failing.app, b.secretCode);
    await failing.idle();

    expect(failRes.status).toBe(200);
    const strip = (body: unknown) => ({ ...(body as object), id: undefined });
    expect(strip(failRes.body)).toEqual(strip(okRes.body));
    expect(failRes.headers["cache-control"]).toBe("no-store");
    expect((await Reservation.findById(b.id).lean())?.status).toBe("cancelled");

    const lines = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"email_failed"'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      kind: "cancellation",
      reservationId: b.id,
      reason: "EENVELOPE",
    });
    for (const secret of [b.secretCode, FAKE_FAILURE_ADDRESS, "jane", "Jane Roe"]) {
      expect(lines[0]).not.toContain(secret);
    }
  });
});
