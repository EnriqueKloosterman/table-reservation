import type { Express } from "express";
import mongoose from "mongoose";
import type { Response } from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Notifier } from "../../src/modules/notifications/notifier.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { hashSecretCode } from "../../src/modules/reservations/secret-code.js";
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

// Feature 004, US4: staff only, secret-free, read-only and uncached (both operations).
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z"); // Monday
const DATE = "2026-11-14"; // Saturday
const SERVICE = [{ name: "Service", start: "17:00", end: "23:59" }];
const COLLECTIONS = [
  "reservations",
  "tablesdays",
  "guestdays",
  "tables",
  "weeklyschedules",
  "closeddates",
  "staffmembers",
];
const ITEM_KEYS = [
  "cancelledAt",
  "cancelledBy",
  "createdAt",
  "date",
  "endTime",
  "guest",
  "id",
  "partySize",
  "startTime",
  "status",
  "table",
];

let app: Express;
let sender: FakeEmailSender;
let notifier: Notifier | undefined;
let token = "";
let consoleSpies: MockInstance<(...args: unknown[]) => void>[] = [];

type Made = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
};

let confirmed: Made;
let guestCancelled: Made;
let staffCancelled: Made;

async function make(n: number, time: string): Promise<Made> {
  const name = `Privacy Guest ${n}`;
  const email = `privacy${n}@mail.com`;
  const phone = `+34 611 000 00${n}`;
  const res = await reserveAs(app, { date: DATE, time, partySize: 2, name, email, phone });
  expect(res.status).toBe(201);
  await notifier?.idle();
  const code = sender.lastCode();
  expect((res.body as { secretCode: string }).secretCode).toBe(code);
  return { id: (res.body as { id: string }).id, code, name, email, phone };
}

beforeEach(async () => {
  consoleSpies = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
  ];
  await seedStaff();
  await seedRestaurant({
    tables: [
      { name: "T1", capacity: 4 },
      { name: "T2", capacity: 4 },
      { name: "T3", capacity: 4 },
    ],
    schedule: { saturday: SERVICE },
  });
  sender = new FakeEmailSender("ok");
  app = buildTestApp({
    now: NOW,
    emailSender: sender,
    onNotifier: (n) => {
      notifier = n;
    },
  });
  token = await loginAs(app);
  confirmed = await make(1, "18:00");
  guestCancelled = await make(2, "19:00");
  staffCancelled = await make(3, "20:00");
  expect((await cancelWithCode(app, guestCancelled.code)).status).toBe(200);
  expect((await cancelAsStaff(app, staffCancelled.id, token)).status).toBe(200);
  await notifier?.idle();
  for (const spy of consoleSpies) spy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// `null` means "send no Authorization header" (`undefined` would fall back to the default token).
const list = (query: string, auth: string | null = token) => {
  const req = kept(app).get(`/reservations${query}`);
  return auth === null ? req : req.set("Authorization", `Bearer ${auth}`);
};
const read = (id: string, auth: string | null = token, query = "") => {
  const req = kept(app).get(`/reservations/${id}${query}`);
  return auth === null ? req : req.set("Authorization", `Bearer ${auth}`);
};

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

const consoleText = (): string =>
  consoleSpies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))).join("\n");

const everyone = () => [confirmed, guestCancelled, staffCancelled];

describe("SC-003: both operations are staff only", () => {
  function badTokens(): [string, string | null][] {
    const [header, payload, signature] = token.split(".") as [string, string, string];
    const i = Math.floor(signature.length / 2);
    const flipped = signature[i] === "A" ? "B" : "A";
    const tampered = `${header}.${payload}.${signature.slice(0, i)}${flipped}${signature.slice(i + 1)}`;
    return [
      ["no Authorization header", null],
      ["a malformed bearer", "not-a-token"],
      ["a tampered token", tampered],
    ];
  }

  it("answers the standard 401 with no personal data for no, malformed, tampered and expired tokens", async () => {
    const cases = badTokens();
    const later = buildTestApp({ now: new Date(NOW.getTime() + 9 * 3600_000), emailSender: sender });
    const targets = [`?date=${DATE}`, `/${confirmed.id}`];
    for (const [label, bad] of cases) {
      for (const target of targets) {
        const res = target.startsWith("?") ? await list(target, bad) : await read(target.slice(1), bad);
        const error = expectError(res, 401, "AUTHENTICATION_REQUIRED");
        expect(error.message, label).toBe("Authentication required");
        for (const m of everyone()) {
          expect(res.text).not.toContain(m.name);
          expect(res.text).not.toContain(m.email);
        }
      }
    }
    for (const path of [`/reservations?date=${DATE}`, `/reservations/${confirmed.id}`]) {
      const res = await kept(later).get(path).set("Authorization", `Bearer ${token}`);
      expectError(res, 401, "AUTHENTICATION_REQUIRED");
    }
  });

  it("the 401 for an unknown or malformed id is identical to the one for an existing id", async () => {
    const answers: Response[] = [];
    for (const id of [confirmed.id, "6741a0ffee0123456789abcd", "abc", "%20"]) answers.push(await read(id, null));
    for (const res of answers) {
      expectError(res, 401, "AUTHENTICATION_REQUIRED");
      expect(res.body).toEqual(answers[0]!.body);
      expect(res.text).toBe(answers[0]!.text);
    }
  });

  it("US4.3: without a token the list is 401 even when the query is invalid; with a token it is 400", async () => {
    for (const query of ["", "?date=2026-02-30", `?date=${DATE}&status=pending`, `?date=${DATE}&foo=1`]) {
      expectError(await list(query, null), 401, "AUTHENTICATION_REQUIRED");
      expectError(await list(query), 400, "VALIDATION_ERROR");
    }
  });
});

function expectNoSecrets(responses: Response[]): void {
  const forbidden = everyone().flatMap((m) => [m.code, hashSecretCode(m.code)]);
  for (const res of responses) {
    const serialized = `${res.text}
${JSON.stringify(res.headers)}`;
    for (const secret of forbidden) expect(serialized).not.toContain(secret);
    const keys = keysDeep(res.body);
    expect(keys.has("secretCode")).toBe(false);
    expect(keys.has("secretCodeHash")).toBe(false);
  }
}

function expectWhitelistedItems(items: object[]): void {
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    for (const key of Object.keys(item)) expect(ITEM_KEYS, `unexpected key ${key}`).toContain(key);
  }
}

describe("SC-004: the secret code and its hash never appear", () => {
  it("list: no 200 or 400 body holds a code, a hash or a secret key; items hold only whitelisted keys", async () => {
    const ok: Response[] = [];
    for (const status of ["", "&status=confirmed", "&status=all", "&status=cancelled"]) {
      const res = await list(`?date=${DATE}${status}`);
      expect(res.status).toBe(200);
      ok.push(res);
    }
    const refused = [await list(""), await list(`?date=${DATE}&status=nope`)];
    expectNoSecrets([...ok, ...refused]);
    expectWhitelistedItems(ok.flatMap((r) => (r.body as { reservations: object[] }).reservations));
  });

  it("single read: no 200, 400 or 404 body holds a code, a hash or a secret key; the item holds only whitelisted keys", async () => {
    const ok: Response[] = [];
    for (const m of everyone()) {
      const res = await read(m.id);
      expect(res.status, `GET /reservations/${m.id}`).toBe(200);
      ok.push(res);
    }
    const refused = [
      await read("6741a0ffee0123456789abcd"),
      await read("abc"),
      await read(confirmed.id, token, "?foo=1"),
    ];
    expectNoSecrets([...ok, ...refused]);
    expectWhitelistedItems(ok.map((r) => r.body as object));
  });

  it("no log line of these requests holds a secret code, a hash or a guest name, email or phone", async () => {
    await list(`?date=${DATE}&status=all`);
    for (const m of everyone()) await read(m.id);
    await read("abc");
    await list("");
    const text = consoleText();
    for (const m of everyone()) {
      for (const secret of [m.code, hashSecretCode(m.code), m.name, m.email, m.phone]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it("500 on the list: standard body, no document, stack or personal data; nothing is written", async () => {
    const before = await Reservation.countDocuments();
    vi.spyOn(Reservation, "find").mockImplementationOnce(
      () => ({ lean: () => Promise.reject(new Error(`db failure for ${confirmed.email}`)) }) as never,
    );
    const res = await list(`?date=${DATE}`);
    const error = expectError(res, 500, "INTERNAL_ERROR");
    expect(error.message).toBe("An unexpected error occurred");
    expect(Object.keys(res.body as object)).toEqual(["error"]);
    for (const m of everyone()) {
      expect(res.text).not.toContain(m.email);
      expect(res.text).not.toContain(m.name);
    }
    expect(res.text).not.toMatch(/stack|\bat \w+/i);
    expect(consoleText()).not.toContain(confirmed.email);
    expect(await Reservation.countDocuments()).toBe(before);
  });

  it("500 on the single read: standard body, no document, stack or personal data; nothing is written", async () => {
    const before = await Reservation.countDocuments();
    vi.spyOn(Reservation, "findById").mockImplementationOnce(
      () => ({ lean: () => Promise.reject(new Error(`db failure for ${confirmed.email}`)) }) as never,
    );
    const res = await read(confirmed.id);
    const error = expectError(res, 500, "INTERNAL_ERROR");
    expect(error.message).toBe("An unexpected error occurred");
    expect(Object.keys(res.body as object)).toEqual(["error"]);
    expect(res.text).not.toContain(confirmed.email);
    expect(res.text).not.toMatch(/stack|\bat \w+/i);
    expect(consoleText()).not.toContain(confirmed.email);
    expect(await Reservation.countDocuments()).toBe(before);
  });
});

describe("no-store", () => {
  it("every 2xx answer of the list carries Cache-Control: no-store", async () => {
    for (const query of [`?date=${DATE}`, `?date=${DATE}&status=all`, "?date=2099-12-31"]) {
      const res = await list(query);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("every 2xx answer of the single read carries Cache-Control: no-store", async () => {
    for (const m of everyone()) {
      const res = await read(m.id);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("SC-008: read-only", () => {
  async function dump(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const name of COLLECTIONS) {
      const docs = await mongoose.connection.collection(name).find({}).toArray();
      out[name] = docs.sort((a, b) => String(a["_id"]).localeCompare(String(b["_id"])));
    }
    return out;
  }

  it("100 mixed calls leave every collection untouched and send no email", async () => {
    await notifier?.idle();
    const before = await dump();
    const emails = sender.sent.length;
    expect(before["reservations"]).toHaveLength(3);

    const calls: (() => Promise<Response>)[] = [
      () => list(`?date=${DATE}`),
      () => list(`?date=${DATE}&status=all`),
      () => list(`?date=${DATE}&status=cancelled`),
      () => list(`?date=${DATE}&status=confirmed`),
      () => list("?date=2026-02-30"),
      () => list(""),
      () => list(`?date=${DATE}`, null),
      () => read(confirmed.id),
      () => read(guestCancelled.id),
      () => read(staffCancelled.id),
      () => read("6741a0ffee0123456789abcd"),
      () => read("abc"),
      () => read(confirmed.id, null),
      () => read(confirmed.id, token, "?foo=1"),
    ];
    for (let i = 0; i < 100; i += 1) await calls[i % calls.length]!();

    await notifier?.idle();
    expect(await dump()).toEqual(before);
    expect(sender.sent).toHaveLength(emails);
  });
});

describe("routing", () => {
  it("GET /reservations/<id>?foo=1 is 400 naming foo; GET /reservations/cancel is a 404 'Reservation not found'; POST /reservations/<id> stays unrouted", async () => {
    const bad = expectError(await read(confirmed.id, token, "?foo=1"), 400, "VALIDATION_ERROR");
    expect(JSON.stringify(bad.details)).toContain("foo");

    const cancelAsId = expectError(await read("cancel"), 404, "NOT_FOUND");
    expect(cancelAsId.message).toBe("Reservation not found");

    const post = await kept(app).post(`/reservations/${confirmed.id}`).set("Authorization", `Bearer ${token}`).send({});
    expect(post.status).toBe(404);
  });

  it("the three POST reservation routes still behave", async () => {
    const created = await reserveAs(app, {
      date: DATE,
      time: "21:00",
      name: "Post Guest",
      email: "post@mail.com",
      phone: "+34 622 000 000",
    });
    expect(created.status).toBe(201);
    await notifier?.idle();
    const code = sender.lastCode();
    const id = (created.body as { id: string }).id;

    const byCode = await cancelWithCode(app, code);
    expect(byCode.status).toBe(200);
    expect((byCode.body as { status: string }).status).toBe("cancelled");

    const again = await reserveAs(app, {
      date: DATE,
      time: "21:30",
      name: "Post Guest Two",
      email: "post2@mail.com",
      phone: "+34 622 000 001",
    });
    expect(again.status).toBe(201);
    const byStaff = await cancelAsStaff(app, (again.body as { id: string }).id, token);
    expect(byStaff.status).toBe(200);
    expect((byStaff.body as { cancelledAt: string }).cancelledAt).toBe(NOW.toISOString());
    expect(id).not.toBe((again.body as { id: string }).id);
  });
});
