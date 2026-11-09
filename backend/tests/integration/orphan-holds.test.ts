import { readFileSync } from "node:fs";
import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";
import { GuestDay, TableDay } from "../../src/modules/reservations/calendar.model.js";
import { Reservation } from "../../src/modules/reservations/reservation.model.js";
import { Table } from "../../src/modules/tables/table.model.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { reserveAs } from "../helpers/reserve-as.js";
import { seedRestaurant } from "../helpers/seed-restaurant.js";
import { useTestDatabase } from "../setup/db.js";

// FR-031: the README documents how to list and remove orphan holds. These tests run the same
// aggregation and the same $pull as the README, so the documentation cannot silently rot.
useTestDatabase();

const FAR_FUTURE = "2099-01-01";
const at = (date: string, time: string) => new Date(`${date}T${time}:00Z`);

/** The pipeline printed in backend/README.md, as plain JavaScript. */
function orphans(collection: "tabledays" | "guestdays") {
  const model = collection === "tabledays" ? TableDay : GuestDay;
  return model.collection
    .aggregate([
      { $unwind: "$intervals" },
      { $match: { "intervals.end": { $gt: new Date() } } },
      {
        $lookup: {
          from: "reservations",
          localField: "intervals.reservationId",
          foreignField: "_id",
          as: "reservation",
        },
      },
      { $match: { reservation: { $size: 0 } } },
      { $project: { _id: 0, tableId: 1, email: 1, date: 1, interval: "$intervals" } },
    ])
    .toArray();
}

describe("README: listing and removing orphan holds", () => {
  const ghost = new Types.ObjectId();
  const past = new Types.ObjectId();
  const tableId = new Types.ObjectId();

  beforeEach(async () => {
    await TableDay.create({
      tableId,
      date: FAR_FUTURE,
      intervals: [{ reservationId: ghost, start: at(FAR_FUTURE, "20:00"), end: at(FAR_FUTURE, "22:00") }],
    });
    await TableDay.create({
      tableId,
      date: "2000-01-01",
      intervals: [{ reservationId: past, start: at("2000-01-01", "20:00"), end: at("2000-01-01", "22:00") }],
    });
    await GuestDay.create({
      email: "ghost@mail.com",
      date: FAR_FUTURE,
      intervals: [{ reservationId: ghost, start: at(FAR_FUTURE, "20:00"), end: at(FAR_FUTURE, "22:00") }],
    });
  });

  it("lists only the intervals that have not ended and have no reservation", async () => {
    const tableOrphans = await orphans("tabledays");
    expect(tableOrphans).toHaveLength(1);
    expect(tableOrphans[0]).toMatchObject({ date: FAR_FUTURE });
    expect((tableOrphans[0]!.tableId as Types.ObjectId).equals(tableId)).toBe(true);
    expect((tableOrphans[0]!.interval as { reservationId: Types.ObjectId }).reservationId.equals(ghost)).toBe(true);

    const guestOrphans = await orphans("guestdays");
    expect(guestOrphans).toHaveLength(1);
    expect(guestOrphans[0]).toMatchObject({ email: "ghost@mail.com", date: FAR_FUTURE });
  });

  it("does not list the holds of a real reservation", async () => {
    await seedRestaurant({
      tables: [{ name: "T4", capacity: 4 }],
      schedule: { saturday: [{ name: "Dinner", start: "18:00", end: "23:30" }] },
    });
    const app = buildTestApp({ now: new Date("2026-11-09T10:00:00Z") });
    expect((await reserveAs(app, { partySize: 4 })).status).toBe(201);
    // the real reservation's intervals end in 2026, before "now" in the pipeline: use a far-future twin
    expect(await Reservation.countDocuments({})).toBe(1);
    const real = (await Reservation.findOne({}).lean())!;
    await Reservation.updateOne({ _id: real._id }, { $set: { endAt: at(FAR_FUTURE, "22:00") } });
    await TableDay.updateOne(
      { tableId: real.tableId },
      { $set: { "intervals.$[i].end": at(FAR_FUTURE, "22:00") } },
      { arrayFilters: [{ "i.reservationId": real._id }] },
    );
    const listed = await orphans("tabledays");
    expect(listed.map((o) => (o.interval as { reservationId: Types.ObjectId }).reservationId.toHexString())).toEqual([
      ghost.toHexString(),
    ]);
  });

  it("the documented $pull removes exactly the orphan and frees the time", async () => {
    await TableDay.collection.updateOne(
      { tableId, date: FAR_FUTURE },
      { $pull: { intervals: { reservationId: ghost } } } as never,
    );
    await GuestDay.collection.updateOne(
      { email: "ghost@mail.com", date: FAR_FUTURE },
      { $pull: { intervals: { reservationId: ghost } } } as never,
    );
    expect(await orphans("tabledays")).toEqual([]);
    expect(await orphans("guestdays")).toEqual([]);
    // the past interval was never touched
    const kept = await TableDay.findOne({ tableId, date: "2000-01-01" }).lean();
    expect(kept!.intervals).toHaveLength(1);
  });

  it("the README contains the documented pipeline and the restore command", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    for (const fragment of [
      "$unwind: \"$intervals\"",
      "\"intervals.end\": { $gt: new Date() }",
      "from: \"reservations\"",
      "reservation: { $size: 0 }",
      "$pull: { intervals: { reservationId: ObjectId(",
      "removed: false, removedAt: null",
    ]) {
      expect(readme, fragment).toContain(fragment);
    }
  });

  it("a table left removed after a failed restore can be put back as documented", async () => {
    const created = await Table.create({
      name: "Lost",
      nameKey: "lost",
      capacity: 2,
      removed: true,
      removedAt: new Date(),
    });
    await Table.collection.updateOne({ _id: created._id }, { $set: { removed: false, removedAt: null } });
    const back = await Table.findById(created._id).lean();
    expect(back).toMatchObject({ removed: false, removedAt: null });
  });
});
