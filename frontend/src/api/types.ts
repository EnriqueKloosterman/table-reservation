import type { components } from "./schema";

export type AvailabilityReason = components["schemas"]["AvailabilityReason"];
export type ConflictReason = components["schemas"]["ConflictReason"];
export type ErrorCode = components["schemas"]["ErrorResponse"]["error"]["code"];

export type BookingField = "date" | "time" | "partySize" | "name" | "email" | "phone";

/** Server field errors are reduced to the field name only (the server text is discarded). */
export type FieldProblem = BookingField | "form";

export interface BookableTimes {
  date: string;
  partySize: number;
  periods: { name: string; times: string[] }[];
  /** Present only when `periods` is empty. */
  reason?: AvailabilityReason;
}

/** Everything the customer may see after booking. No secret code, table, id, email or phone. */
export interface Confirmation {
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
  guestName: string;
}

export interface CancellationDone {
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
}

export type ApiResult<T, R> =
  | { kind: "success"; value: T }
  | { kind: "refusal"; refusal: R }
  | { kind: "serverError" }
  | { kind: "unreachable" };

/** Internal: the caller cancelled the request. Never rendered. */
export interface Aborted {
  kind: "aborted";
}

/** An error code that is not one of the typed refusals below (known or unknown string). */
export interface OtherRefusal {
  code: string;
}

export interface ValidationRefusal {
  code: "VALIDATION_ERROR";
  fields: FieldProblem[];
}

export type TimesRefusal = ValidationRefusal | OtherRefusal;

export type CreateRefusal =
  | ValidationRefusal
  | { code: "CONFLICT"; reason: string }
  | { code: "NO_AVAILABILITY"; reason: string }
  | OtherRefusal;

export type CancelRefusal =
  | { code: "VALIDATION_ERROR" }
  | { code: "NOT_FOUND" }
  | { code: "ALREADY_CANCELLED" }
  | { code: "CANNOT_CANCEL" }
  | OtherRefusal;

export interface TimesQuery {
  date: string;
  partySize: number;
}

export interface CreateInput {
  date: string;
  time: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
}

export interface CancelInput {
  code: string;
}

export interface ApiClient {
  getTimes(
    query: TimesQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<BookableTimes, TimesRefusal> | Aborted>;
  createReservation(
    input: CreateInput,
    signal?: AbortSignal,
  ): Promise<ApiResult<Confirmation, CreateRefusal> | Aborted>;
  cancelReservation(
    input: CancelInput,
    signal?: AbortSignal,
  ): Promise<ApiResult<CancellationDone, CancelRefusal> | Aborted>;
}
