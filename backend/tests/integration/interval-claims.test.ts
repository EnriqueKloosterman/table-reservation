import mongoose, { Schema, Types, model } from "mongoose";
import { initModels, registerModel } from "../../src/db/connection.js";
import { describe, expect, it, vi } from "vitest";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import {
  claimInterval,
  releaseInterval,
} from "../../src/modules/reservations/interval-claims.js";
import { useTestDatabase } from "../setup/db.js";

useTestDatabase();

const DATE = "2026-11-14";
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00Z`);
const claim = (key: { tableId: Types.ObjectId; date: string }, from: string, to: string) => ({
  reservationId: new Types.ObjectId(),
  start: at(from),
  end: at(to),
  key,
});

const intervalsOf = async (tableId: Types.ObjectId) => {
  const doc = await TableDay.findOne({ tableId, date: DATE }).lean();
  return doc?.intervals ?? [];
};

function dbError(code: number | undefined, message = "boom"): Error {
  return Object.assign(new Error(message), code === undefined ? {} : { code });
}

describe("claimInterval", () => {
  it("creates the calendar document on the first claim (upsert)", async () => {
    const tableId = new Types.ObjectId();
    const c = claim({ tableId, date: DATE }, "20:00", "22:00");
    expect(await claimInterval(TableDay, c.key, c)).toBe(true);
    expect(await TableDay.countDocuments({ tableId, date: DATE })).toBe(1);
    const intervals = await intervalsOf(tableId);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.reservationId.equals(c.reservationId)).toBe(true);
    expect(intervals[0]!.start).toEqual(c.start);
    expect(intervals[0]!.end).toEqual(c.end);
  });

  it("accepts a non-overlapping second claim on the same document", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    expect(await claimInterval(TableDay, key, claim(key, "12:00", "14:00"))).toBe(true);
    expect(await claimInterval(TableDay, key, claim(key, "20:00", "22:00"))).toBe(true);
    expect(await intervalsOf(tableId)).toHaveLength(2);
    expect(await TableDay.countDocuments({ tableId, date: DATE })).toBe(1);
  });

  it("returns false for an overlapping claim and changes nothing", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    expect(await claimInterval(TableDay, key, claim(key, "20:00", "22:00"))).toBe(true);
    const before = await intervalsOf(tableId);
    for (const [from, to] of [
      ["21:00", "23:00"],
      ["19:00", "21:00"],
      ["20:00", "22:00"],
      ["20:30", "21:30"],
      ["19:00", "23:00"],
    ] as const) {
      expect(await claimInterval(TableDay, key, claim(key, from, to)), `${from}-${to}`).toBe(false);
    }
    expect(await intervalsOf(tableId)).toEqual(before);
    expect(await TableDay.countDocuments({ tableId, date: DATE })).toBe(1);
  });

  it("touching ranges both succeed (half-open)", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    expect(await claimInterval(TableDay, key, claim(key, "20:00", "22:00"))).toBe(true);
    expect(await claimInterval(TableDay, key, claim(key, "22:00", "23:59"))).toBe(true);
    expect(await claimInterval(TableDay, key, claim(key, "18:00", "20:00"))).toBe(true);
    expect(await intervalsOf(tableId)).toHaveLength(3);
  });

  it("works for guest calendars keyed by email", async () => {
    const key = { email: "ana@mail.com", date: DATE };
    const a = { reservationId: new Types.ObjectId(), start: at("20:00"), end: at("22:00") };
    const b = { reservationId: new Types.ObjectId(), start: at("21:00"), end: at("23:00") };
    expect(await claimInterval(GuestDay, key, a)).toBe(true);
    expect(await claimInterval(GuestDay, key, b)).toBe(false);
    expect(await claimInterval(GuestDay, { ...key, date: "2026-11-15" }, b)).toBe(true);
  });

  it("20 concurrent claims for one overlapping range: exactly one true, no stored overlap", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => claimInterval(TableDay, key, claim(key, "20:00", "22:00"))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await TableDay.countDocuments({ tableId, date: DATE })).toBe(1);
    const intervals = await intervalsOf(tableId);
    expect(intervals).toHaveLength(1);
  });

  it("concurrent claims with staggered overlapping ranges never leave an overlap", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    const base = at("08:00").getTime();
    const ranges = Array.from({ length: 24 }, (_v, i) => ({
      reservationId: new Types.ObjectId(),
      start: new Date(base + i * 30 * 60_000),
      end: new Date(base + (i * 30 + 120) * 60_000),
    }));
    const results = await Promise.all(ranges.map((r) => claimInterval(TableDay, key, r)));
    const stored = await intervalsOf(tableId);
    expect(stored).toHaveLength(results.filter(Boolean).length);
    for (let i = 0; i < stored.length; i++) {
      for (let j = i + 1; j < stored.length; j++) {
        const a = stored[i]!;
        const b = stored[j]!;
        expect(a.start < b.end && b.start < a.end).toBe(false);
      }
    }
  });

  it("concurrent first claims on a missing document exercise the 11000 retry path", async () => {
    // Non-overlapping ranges: every claim must succeed even though many race to create the document.
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    const spy = vi.spyOn(TableDay, "updateOne");
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_v, i) =>
          claimInterval(
            TableDay,
            key,
            claim(key, `${String(8 + i).padStart(2, "0")}:00`, `${String(8 + i).padStart(2, "0")}:30`),
          ),
        ),
      );
      expect(results.every(Boolean)).toBe(true);
      expect(await TableDay.countDocuments({ tableId, date: DATE })).toBe(1);
      expect(await intervalsOf(tableId)).toHaveLength(12);
      // at least one claim lost the creation race and retried without upsert
      expect(spy.mock.calls.length).toBeGreaterThan(12);
    } finally {
      spy.mockRestore();
    }
  });

  describe("error handling (stubbed model)", () => {
    const interval = () => ({
      reservationId: new Types.ObjectId(),
      start: at("20:00"),
      end: at("22:00"),
    });
    const key = { tableId: new Types.ObjectId(), date: DATE };
    const callsOf = (m: typeof TableDay) =>
      (m.updateOne as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const stub = (impl: (...args: unknown[]) => Promise<unknown>) =>
      ({ updateOne: vi.fn(impl) }) as unknown as typeof TableDay;

    it("rethrows a non-11000 database error and never returns false", async () => {
      const model = stub(() => Promise.reject(dbError(undefined, "network down")));
      await expect(claimInterval(model, key, interval())).rejects.toThrow("network down");
      expect(callsOf(model)).toHaveLength(1);
    });

    it("rethrows an error with another code (e.g. 50) too", async () => {
      const model = stub(() => Promise.reject(dbError(50, "timeout")));
      await expect(claimInterval(model, key, interval())).rejects.toThrow("timeout");
    });

    it("retries once without upsert on 11000 and maps matchedCount 0 to false", async () => {
      const model = stub(
        vi
          .fn()
          .mockRejectedValueOnce(dbError(11000))
          .mockResolvedValueOnce({ matchedCount: 0, upsertedCount: 0 }),
      );
      expect(await claimInterval(model, key, interval())).toBe(false);
      const calls = callsOf(model);
      expect(calls).toHaveLength(2);
      expect(calls[0]![2]).toMatchObject({ upsert: true });
      expect(calls[1]![2] ?? {}).not.toMatchObject({ upsert: true });
    });

    it("retries once on 11000 and maps matchedCount 1 to true", async () => {
      const model = stub(
        vi
          .fn()
          .mockRejectedValueOnce(dbError(11000))
          .mockResolvedValueOnce({ matchedCount: 1, upsertedCount: 0 }),
      );
      expect(await claimInterval(model, key, interval())).toBe(true);
    });

    it("rethrows a non-11000 error raised by the retry", async () => {
      const model = stub(
        vi
          .fn()
          .mockRejectedValueOnce(dbError(11000))
          .mockRejectedValueOnce(dbError(undefined, "retry failed")),
      );
      await expect(claimInterval(model, key, interval())).rejects.toThrow("retry failed");
    });

    it("does not retry a second time when the retry also reports 11000", async () => {
      const model = stub(vi.fn().mockRejectedValue(dbError(11000, "dup again")));
      await expect(claimInterval(model, key, interval())).rejects.toThrow("dup again");
      expect(callsOf(model)).toHaveLength(2);
    });
  });
});

describe("releaseInterval", () => {
  it("removes only the caller's own reservationId", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    const a = claim(key, "12:00", "14:00");
    const b = claim(key, "20:00", "22:00");
    await claimInterval(TableDay, key, a);
    await claimInterval(TableDay, key, b);
    await releaseInterval(TableDay, key, a.reservationId);
    const left = await intervalsOf(tableId);
    expect(left).toHaveLength(1);
    expect(left[0]!.reservationId.equals(b.reservationId)).toBe(true);
    // the freed range can be claimed again; the calendar document is kept
    expect(await claimInterval(TableDay, key, claim(key, "12:30", "13:30"))).toBe(true);
    expect(await TableDay.countDocuments({ tableId, date: DATE })).toBe(1);
  });

  it("is a no-op for an unknown reservationId", async () => {
    const tableId = new Types.ObjectId();
    const key = { tableId, date: DATE };
    await claimInterval(TableDay, key, claim(key, "20:00", "22:00"));
    const before = await intervalsOf(tableId);
    await releaseInterval(TableDay, key, new Types.ObjectId());
    expect(await intervalsOf(tableId)).toEqual(before);
  });

  it("is a no-op when the calendar document does not exist", async () => {
    const key = { tableId: new Types.ObjectId(), date: DATE };
    await expect(releaseInterval(TableDay, key, new Types.ObjectId())).resolves.toBeUndefined();
    expect(await TableDay.countDocuments({})).toBe(0);
  });
});

describe("calendar indexes", () => {
  it("builds the unique { tableId, date } and { email, date } indexes via initModels()", async () => {
    const tableIndexes = await TableDay.collection.indexes();
    const guestIndexes = await GuestDay.collection.indexes();
    expect(
      tableIndexes.some((i) => i.unique === true && JSON.stringify(i.key) === '{"tableId":1,"date":1}'),
    ).toBe(true);
    expect(
      guestIndexes.some((i) => i.unique === true && JSON.stringify(i.key) === '{"email":1,"date":1}'),
    ).toBe(true);
  });

  it("a duplicate calendar document insert fails with 11000", async () => {
    const tableId = new Types.ObjectId();
    await TableDay.create({ tableId, date: DATE, intervals: [] });
    await expect(TableDay.create({ tableId, date: DATE, intervals: [] })).rejects.toMatchObject({
      code: 11000,
    });
    await GuestDay.create({ email: "a@b.co", date: DATE, intervals: [] });
    await expect(GuestDay.create({ email: "a@b.co", date: DATE, intervals: [] })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe("initModels() and unique index failures (T016)", () => {
  it("rejects when a registered model's unique index cannot be built", async () => {
    // Existing duplicates make the unique index impossible: init() must reject, so that
    // server startup (which awaits initModels()) fails instead of running without the index.
    await mongoose.connection.collection("unbuildable_days").insertMany([
      { tableId: "x", date: DATE },
      { tableId: "x", date: DATE },
    ]);
    const schema = new Schema({ tableId: String, date: String });
    schema.index({ tableId: 1, date: 1 }, { unique: true });
    const Unbuildable = registerModel(model("UnbuildableDay", schema, "unbuildable_days"));
    await expect(initModels()).rejects.toThrow();
    await expect(Unbuildable.init()).rejects.toThrow();
  });
});
