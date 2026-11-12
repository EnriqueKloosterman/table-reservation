import type { BookableTimes, CancellationDone, Confirmation } from "../../src/api/types";
import type { CancelResult, CreateResult, TimesResult } from "./fake-api-client";

export const DATE = "2026-11-14";
export const DATE_TEXT = "Saturday 14 November 2026";

export const PERIODS: BookableTimes["periods"] = [
  { name: "Lunch", times: ["13:00", "13:30"] },
  { name: "Dinner", times: ["20:00", "20:30"] },
];

export function timesOk(periods = PERIODS, partySize = 4): TimesResult {
  return { kind: "success", value: { date: DATE, partySize, periods } };
}

export function timesEmpty(reason?: string): TimesResult {
  return {
    kind: "success",
    value: {
      date: DATE,
      partySize: 4,
      periods: [],
      ...(reason === undefined ? {} : { reason: reason as never }),
    },
  };
}

export const CONFIRMATION: Confirmation = {
  date: DATE,
  startTime: "20:00",
  endTime: "21:30",
  partySize: 4,
  guestName: "Ana Perez",
};

export function createOk(): CreateResult {
  return { kind: "success", value: CONFIRMATION };
}

export const CANCELLED: CancellationDone = {
  date: DATE,
  startTime: "20:00",
  endTime: "21:30",
  partySize: 4,
};

export function cancelOk(): CancelResult {
  return { kind: "success", value: CANCELLED };
}

export function cancelRefused(code: string): CancelResult {
  return { kind: "refusal", refusal: { code } as never };
}
