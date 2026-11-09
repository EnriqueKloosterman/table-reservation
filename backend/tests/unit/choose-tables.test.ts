import { describe, expect, it } from "vitest";
import { chooseTables } from "../../src/modules/availability/availability.domain.js";
import { iv, table } from "../helpers/day-snapshot.js";

const range = iv("2026-11-14", "20:00", "22:00");

describe("chooseTables", () => {
  it("keeps only tables with capacity >= party size", () => {
    const tables = [table("a", "A", 2), table("b", "B", 4), table("c", "C", 6)];
    expect(chooseTables(tables, 3, new Map(), range).map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("accepts a table whose capacity equals the party size", () => {
    expect(chooseTables([table("a", "A", 4)], 4, new Map(), range)).toEqual([table("a", "A", 4)]);
  });

  it("drops tables with an overlapping interval", () => {
    const tables = [table("a", "A", 4), table("b", "B", 4)];
    const held = new Map([["a", [iv("2026-11-14", "21:00", "23:00")]]]);
    expect(chooseTables(tables, 2, held, range).map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps tables whose intervals only touch the range", () => {
    const tables = [table("a", "A", 4)];
    const held = new Map([
      ["a", [iv("2026-11-14", "18:00", "20:00"), iv("2026-11-14", "22:00", "23:59")]],
    ]);
    expect(chooseTables(tables, 2, held, range)).toHaveLength(1);
  });

  it("sorts by capacity ascending, then by name", () => {
    const tables = [table("a", "Zeta", 6), table("b", "Beta", 4), table("c", "Alpha", 4)];
    expect(chooseTables(tables, 2, new Map(), range).map((t) => t.name)).toEqual([
      "Alpha",
      "Beta",
      "Zeta",
    ]);
  });

  it('orders names naturally: "T2" before "T10", case-insensitive', () => {
    const tables = [table("a", "T10", 4), table("b", "T2", 4), table("c", "t3", 4)];
    expect(chooseTables(tables, 4, new Map(), range).map((t) => t.name)).toEqual([
      "T2",
      "t3",
      "T10",
    ]);
  });

  it("returns the whole ordered list, not only the first table", () => {
    const tables = [table("a", "A", 2), table("b", "B", 4), table("c", "C", 4), table("d", "D", 6)];
    expect(chooseTables(tables, 2, new Map(), range)).toHaveLength(4);
  });

  it("is empty when no table qualifies", () => {
    expect(chooseTables([table("a", "A", 2)], 4, new Map(), range)).toEqual([]);
    expect(chooseTables([], 1, new Map(), range)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const tables = [table("a", "B", 4), table("b", "A", 4)];
    chooseTables(tables, 2, new Map(), range);
    expect(tables.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
