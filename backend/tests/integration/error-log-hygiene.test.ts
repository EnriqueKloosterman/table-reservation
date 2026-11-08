import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { errorMiddleware } from "../../src/shared/errors/error-middleware.js";
import { buildTestApp, type BuildTestAppOptions } from "../helpers/build-test-app.js";
import { expectError } from "../helpers/expect-error.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, T053 / FR-020: the logs of unexpected errors never carry the secret code hash,
// the guest address or the guest name, even when a driver error embeds them in its message.
useTestDatabase();

const NOW = new Date("2026-11-09T10:00:00Z");
const DINNER = { name: "Dinner", start: "18:00", end: "23:30" };

const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const ADDRESS = "zelda.secret@mail.test";
const NAME = "Zelda Secretname";
const SECRETS = [HASH, ADDRESS, "zelda.secret", NAME, "Secretname"];

/** A driver-style error whose message, fields and cause all embed the sensitive values. */
const leakyError = () =>
  Object.assign(
    new Error(
      `E11000 duplicate key error index: secretCodeHash_1 dup key: { secretCodeHash: "${HASH}" } ` +
        `guest ${NAME} <${ADDRESS}>`,
    ),
    {
      name: "MongoServerError",
      code: 11000,
      keyValue: { secretCodeHash: HASH, email: ADDRESS },
      cause: new Error(`${NAME} ${ADDRESS}`),
    },
  );

let errorLog: MockInstance<typeof console.error>;

beforeEach(async () => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  await seedRestaurant({ tables: [{ name: "T4", capacity: 4 }], schedule: { saturday: [DINNER] } });
});

afterEach(() => vi.restoreAllMocks());

const reserve = (options: BuildTestAppOptions) =>
  reserveAs(buildTestApp({ now: NOW, ...options }), {
    date: "2026-11-14",
    time: "18:00",
    partySize: 4,
    name: NAME,
    email: ADDRESS,
  });

/** Everything written through console.error, as one string (objects expanded). */
function logged(): string {
  return errorLog.mock.calls
    .flat()
    .map((arg) =>
      arg instanceof Error
        ? JSON.stringify({ ...arg, name: arg.name, message: arg.message, stack: arg.stack, cause: String(arg.cause) })
        : typeof arg === "string"
          ? arg
          : JSON.stringify(arg),
    )
    .join("\n");
}

function expectClean(): void {
  expect(errorLog).toHaveBeenCalled(); // the failure is still recorded
  const text = logged();
  for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
}

describe("unexpected errors are logged by name and code only", () => {
  it("a failed insert (Reservation failed)", async () => {
    const res = await reserve({ reservationOps: { insertReservation: () => Promise.reject(leakyError()) } });
    expectError(res, 500, "INTERNAL_ERROR");
    expectClean();
  });

  it("a failed release of a hold after a failed insert (Could not release a time hold)", async () => {
    const res = await reserve({
      reservationOps: {
        insertReservation: () => Promise.reject(leakyError()),
        release: () => Promise.reject(leakyError()),
      },
    });
    expectError(res, 500, "INTERNAL_ERROR");
    expectClean();
  });

  it("an unconfirmed store (Could not confirm whether the reservation was stored)", async () => {
    const network = Object.assign(new Error(`connection lost for ${ADDRESS}`), { name: "MongoNetworkError" });
    const res = await reserve({
      reservationOps: {
        insertReservation: () => Promise.reject(network),
        reservationExists: () => Promise.reject(leakyError()),
      },
    });
    expectError(res, 500, "INTERNAL_ERROR");
    expectClean();
  });

  it("a failed post-store verification (Post-store verification could not read the configuration)", async () => {
    const res = await reserve({ reservationOps: { loadConfigState: () => Promise.reject(leakyError()) } });
    expect(res.status).toBe(201); // the reservation passed every check and is kept
    expectClean();
  });

  it("the error middleware logs an unexpected error without its message or fields", () => {
    const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    // Code 11000 would be mapped to a 409 by the middleware; use an error it does not know.
    const unexpected = Object.assign(leakyError(), { code: 9001 });
    errorMiddleware(unexpected, {} as Request, res as unknown as Response, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expectClean();
  });
});
