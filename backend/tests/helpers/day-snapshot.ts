import type {
  DaySnapshot,
  Interval,
  Rules,
  TableInfo,
} from "../../src/modules/availability/availability.domain.js";

export const NOW = new Date("2026-11-09T10:00:00.000Z"); // Monday, 10:00 UTC

export const DEFAULT_RULES: Rules = {
  timeZone: "UTC",
  durationMinutes: 120,
  slotIntervalMinutes: 15,
  minNoticeMinutes: 60,
  horizonDays: 60,
};

export type SnapshotOverrides = Partial<Omit<DaySnapshot, "rules">> & { rules?: Partial<Rules> };

/** A Saturday with one dinner period and one 4-seat table, "now" pinned to Monday 10:00 UTC. */
export function makeSnapshot(over: SnapshotOverrides = {}): DaySnapshot {
  return {
    now: NOW,
    date: "2026-11-14",
    periods: [{ name: "Dinner", start: "20:00", end: "23:30" }],
    isClosedDate: false,
    tables: [{ id: "t4", name: "T4", capacity: 4 }],
    intervalsByTable: new Map(),
    ...over,
    rules: { ...DEFAULT_RULES, ...over.rules },
  };
}

/** UTC interval on `date` from `from` to `to` (both `HH:mm`). */
export function iv(date: string, from: string, to: string): Interval {
  return { start: new Date(`${date}T${from}:00Z`), end: new Date(`${date}T${to}:00Z`) };
}

export function table(id: string, name: string, capacity: number): TableInfo {
  return { id, name, capacity };
}
