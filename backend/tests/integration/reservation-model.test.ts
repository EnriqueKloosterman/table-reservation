import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { useTestDatabase } from "../setup/db.js";

// Feature 003, data-model.md: the status enum, the cancellation fields and the unique code hash.
useTestDatabase();

const base = () => ({
  tableId: new Types.ObjectId(),
  date: "2026-11-14",
  startTime: "20:00",
  endTime: "22:00",
  startAt: new Date("2026-11-14T20:00:00Z"),
  endAt: new Date("2026-11-14T22:00:00Z"),
  partySize: 2,
  guestName: "Ana Guest",
  guestEmail: "ana@mail.com",
  guestPhone: "+34 600 111 222",
  secretCodeHash: "a".repeat(64),
  createdAt: new Date("2026-11-07T10:00:00Z"),
});

describe("Reservation model (feature 003)", () => {
  it("reads a document stored without cancelledAt/cancelledBy back with both null", async () => {
    // Simulates a reservation stored before this feature: written straight to the collection.
    const _id = new Types.ObjectId();
    await Reservation.collection.insertOne({ _id, status: "confirmed", ...base() });

    const found = await Reservation.findById(_id);
    expect(found?.status).toBe("confirmed");
    expect(found?.cancelledAt).toBeNull();
    expect(found?.cancelledBy).toBeNull();
  });

  it("defaults a new reservation to confirmed with null cancellation fields", async () => {
    const created = await Reservation.create(base());
    expect(created.status).toBe("confirmed");
    expect(created.cancelledAt).toBeNull();
    expect(created.cancelledBy).toBeNull();
  });

  it("accepts exactly confirmed and cancelled for status", async () => {
    await expect(Reservation.create({ ...base(), secretCodeHash: "1".repeat(64), status: "confirmed" })).resolves.toBeDefined();
    await expect(
      Reservation.create({
        ...base(),
        secretCodeHash: "2".repeat(64),
        status: "cancelled",
        cancelledAt: new Date("2026-11-08T10:00:00Z"),
        cancelledBy: "guest",
      }),
    ).resolves.toBeDefined();
    for (const status of ["pending", "canceled", "CANCELLED", "", "no_show"]) {
      await expect(
        Reservation.create({ ...base(), secretCodeHash: "3".repeat(64), status: status as "confirmed" }),
      ).rejects.toThrow(/status/);
    }
  });

  it("accepts guest and staff for cancelledBy and refuses anything else", async () => {
    for (const [i, by] of (["guest", "staff"] as const).entries()) {
      await expect(
        Reservation.create({
          ...base(),
          secretCodeHash: String(i + 4).repeat(64),
          status: "cancelled",
          cancelledAt: new Date("2026-11-08T10:00:00Z"),
          cancelledBy: by,
        }),
      ).resolves.toBeDefined();
    }
    await expect(
      Reservation.create({ ...base(), secretCodeHash: "6".repeat(64), cancelledBy: "owner" as "guest" }),
    ).rejects.toThrow(/cancelledBy/);
  });

  it("builds a unique index on secretCodeHash and rejects a duplicate hash with error 11000", async () => {
    await Reservation.init();
    const indexes = await Reservation.collection.indexes();
    const unique = indexes.find((i) => i.key && "secretCodeHash" in i.key);
    expect(unique?.unique).toBe(true);

    await Reservation.create({ ...base(), secretCodeHash: "d".repeat(64) });
    await expect(Reservation.create({ ...base(), secretCodeHash: "d".repeat(64) })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("still excludes secretCodeHash from default reads and serialization", async () => {
    const created = await Reservation.create({ ...base(), secretCodeHash: "e".repeat(64) });
    const found = await Reservation.findById(created._id);
    expect(found?.secretCodeHash).toBeUndefined();
    expect(JSON.stringify(found)).not.toContain("e".repeat(64));
    expect(JSON.stringify(created)).not.toContain("e".repeat(64));

    const withHash = await Reservation.findById(created._id).select("+secretCodeHash");
    expect(withHash?.secretCodeHash).toBe("e".repeat(64));
  });
});
