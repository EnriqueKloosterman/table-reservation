import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  buildSummary,
  sortReservations,
  toReservationView,
  type ReservationRow,
} from "../../src/modules/reservations/reservation-view.domain.js";

let counter = 0;
const oid = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, "0"));

function row(over: Partial<ReservationRow> & Record<string, unknown> = {}): ReservationRow {
  counter += 1;
  return {
    _id: oid(counter),
    status: "confirmed",
    date: "2026-11-14",
    startTime: "20:30",
    endTime: "22:30",
    startAt: new Date("2026-11-14T19:30:00.000Z"),
    partySize: 3,
    guestName: "Ana García",
    guestEmail: "ana@mail.com",
    guestPhone: "+34 600 123 456",
    tableId: oid(1000 + counter),
    createdAt: new Date("2026-11-07T10:15:00.000Z"),
    ...over,
  };
}

const names = (map: Record<string, string>) => (tableId: Types.ObjectId) => map[tableId.toHexString()] ?? "unknown";

describe("sortReservations", () => {
  it("orders by start instant ascending", () => {
    const late = row({ startAt: new Date("2026-11-14T21:00:00.000Z") });
    const early = row({ startAt: new Date("2026-11-14T18:00:00.000Z") });
    const mid = row({ startAt: new Date("2026-11-14T19:30:00.000Z") });
    const sorted = sortReservations([late, early, mid], () => "T1");
    expect(sorted.map((r) => r._id.toHexString())).toEqual(
      [early, mid, late].map((r) => r._id.toHexString()),
    );
  });

  it("breaks start ties by table name in natural order (T2 before T10)", () => {
    const t10 = row({ tableId: oid(5010) });
    const t2 = row({ tableId: oid(5002) });
    const nameOf = names({ [oid(5010).toHexString()]: "T10", [oid(5002).toHexString()]: "T2" });
    expect(sortReservations([t10, t2], nameOf).map((r) => r._id.toHexString())).toEqual([
      t2._id.toHexString(),
      t10._id.toHexString(),
    ]);
  });

  it("compares table names case-insensitively", () => {
    const upper = row({ tableId: oid(6001) });
    const lower = row({ tableId: oid(6002) });
    const nameOf = names({ [oid(6001).toHexString()]: "b1", [oid(6002).toHexString()]: "A1" });
    expect(sortReservations([upper, lower], nameOf)[0]!._id.toHexString()).toBe(lower._id.toHexString());
  });

  it("breaks the last tie by the id hex string", () => {
    const a = row({ _id: oid(9001), tableId: oid(7000) });
    const b = row({ _id: oid(9002), tableId: oid(7000) });
    const sorted = sortReservations([b, a], () => "T1");
    expect(sorted.map((r) => r._id.toHexString())).toEqual([a._id.toHexString(), b._id.toHexString()]);
  });

  it("is total: shuffled input always gives the identical output", () => {
    const rows = [
      row({ startAt: new Date("2026-11-14T19:00:00.000Z"), tableId: oid(8001) }),
      row({ startAt: new Date("2026-11-14T19:00:00.000Z"), tableId: oid(8002) }),
      row({ startAt: new Date("2026-11-14T19:00:00.000Z"), tableId: oid(8002) }),
      row({ startAt: new Date("2026-11-14T18:00:00.000Z"), tableId: oid(8003) }),
      row({ startAt: new Date("2026-11-14T20:00:00.000Z"), tableId: oid(8001) }),
    ];
    const nameOf = names({
      [oid(8001).toHexString()]: "T10",
      [oid(8002).toHexString()]: "T2",
      [oid(8003).toHexString()]: "T3",
    });
    const expected = sortReservations(rows, nameOf).map((r) => r._id.toHexString());
    for (let i = 0; i < 50; i += 1) {
      const shuffled = [...rows].sort(() => Math.random() - 0.5);
      expect(sortReservations(shuffled, nameOf).map((r) => r._id.toHexString())).toEqual(expected);
    }
  });

  it("returns a new array and does not mutate the input", () => {
    const rows = [
      row({ startAt: new Date("2026-11-14T21:00:00.000Z") }),
      row({ startAt: new Date("2026-11-14T18:00:00.000Z") }),
    ];
    const before = rows.map((r) => r._id.toHexString());
    const sorted = sortReservations(rows, () => "T1");
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r._id.toHexString())).toEqual(before);
  });
});

describe("buildSummary", () => {
  it("counts confirmed reservations, sums their party sizes and counts distinct tables", () => {
    const rows = [
      row({ partySize: 2, tableId: oid(1) }),
      row({ partySize: 4, tableId: oid(2) }),
      row({ partySize: 5, tableId: oid(3) }),
    ];
    expect(buildSummary(rows)).toEqual({ reservations: 3, guests: 11, tablesUsed: 3 });
  });

  it("counts two reservations on one table as one table", () => {
    const rows = [row({ tableId: oid(1) }), row({ tableId: oid(1) })];
    expect(buildSummary(rows).tablesUsed).toBe(1);
  });

  it("counts distinct table ids, not names (two ids with the same name are two tables)", () => {
    const rows = [row({ tableId: oid(1) }), row({ tableId: oid(2) })];
    expect(buildSummary(rows).tablesUsed).toBe(2);
  });

  it("ignores cancelled rows in every figure", () => {
    const rows = [
      row({ partySize: 2, tableId: oid(1) }),
      row({ status: "cancelled", partySize: 9, tableId: oid(2) }),
    ];
    expect(buildSummary(rows)).toEqual({ reservations: 1, guests: 2, tablesUsed: 1 });
  });

  it("is all zeros for empty input and for only-cancelled input", () => {
    expect(buildSummary([])).toEqual({ reservations: 0, guests: 0, tablesUsed: 0 });
    expect(buildSummary([row({ status: "cancelled" }), row({ status: "cancelled" })])).toEqual({
      reservations: 0,
      guests: 0,
      tablesUsed: 0,
    });
  });
});

describe("toReservationView", () => {
  const KEYS = [
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

  it("returns exactly the whitelisted keys for a confirmed row", () => {
    const r = row();
    const view = toReservationView(r, "T4");
    expect(Object.keys(view).sort()).toEqual(KEYS);
    expect(view).toEqual({
      id: r._id.toHexString(),
      status: "confirmed",
      date: "2026-11-14",
      startTime: "20:30",
      endTime: "22:30",
      partySize: 3,
      guest: { name: "Ana García", email: "ana@mail.com", phone: "+34 600 123 456" },
      table: { name: "T4" },
      createdAt: "2026-11-07T10:15:00.000Z",
    });
    expect(Object.keys(view.guest).sort()).toEqual(["email", "name", "phone"]);
    expect(Object.keys(view.table)).toEqual(["name"]);
  });

  it("omits cancelledAt / cancelledBy for a confirmed row even when the row carries null", () => {
    const view = toReservationView(row({ cancelledAt: null, cancelledBy: null }), "T4");
    expect("cancelledAt" in view).toBe(false);
    expect("cancelledBy" in view).toBe(false);
  });

  it("adds cancelledAt (ISO-8601 UTC) and cancelledBy for a cancelled row", () => {
    const view = toReservationView(
      row({ status: "cancelled", cancelledAt: new Date("2026-11-10T09:30:00.000Z"), cancelledBy: "guest" }),
      "T4",
    );
    expect(view.status).toBe("cancelled");
    expect(view.cancelledAt).toBe("2026-11-10T09:30:00.000Z");
    expect(view.cancelledBy).toBe("guest");
    expect(Object.keys(view).sort()).toEqual([...KEYS, "cancelledAt", "cancelledBy"].sort());
  });

  it("renders a cancelled row missing those fields without them instead of throwing", () => {
    const view = toReservationView(row({ status: "cancelled" }), "T4");
    expect(view.status).toBe("cancelled");
    expect("cancelledAt" in view).toBe(false);
    expect("cancelledBy" in view).toBe(false);
  });

  it("renders createdAt as ISO-8601 UTC and id as the 24-hex string", () => {
    const view = toReservationView(row({ createdAt: new Date("2026-11-07T12:15:00.000+02:00") }), "T4");
    expect(view.createdAt).toBe("2026-11-07T10:15:00.000Z");
    expect(view.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("yields none of the extra properties a row may carry", () => {
    const view = toReservationView(
      row({
        secretCodeHash: "deadbeef",
        secretCode: "plain-code",
        endAt: new Date(),
        __v: 0,
      }),
      "T4",
    );
    const flat = JSON.stringify(view);
    for (const forbidden of ["secretCodeHash", "secretCode", "startAt", "tableId", "endAt", "__v", "_id", "deadbeef", "plain-code"]) {
      expect(flat).not.toContain(forbidden);
    }
    expect(Object.keys(view).sort()).toEqual(KEYS);
  });
});
