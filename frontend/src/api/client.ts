import type {
  Aborted,
  ApiClient,
  ApiResult,
  BookableTimes,
  BookingField,
  CancelRefusal,
  CancellationDone,
  Confirmation,
  CreateRefusal,
  FieldProblem,
  TimesRefusal,
} from "./types";

interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Outcome =
  | { kind: "http"; status: number; body: unknown }
  | { kind: "unreachable" }
  | Aborted;

const BOOKING_FIELDS: readonly string[] = ["date", "time", "partySize", "name", "email", "phone"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTimes(body: unknown): BookableTimes | null {
  if (!isRecord(body)) return null;
  const { date, partySize, periods, reason } = body;
  if (!isString(date) || !isNumber(partySize) || !Array.isArray(periods)) return null;
  const kept: BookableTimes["periods"] = [];
  for (const period of periods as unknown[]) {
    if (!isRecord(period) || !isString(period.name) || !Array.isArray(period.times)) return null;
    const times = period.times as unknown[];
    if (!times.every(isString)) return null;
    if (times.length > 0) kept.push({ name: period.name, times: [...times] });
  }
  const result: BookableTimes = { date, partySize, periods: kept };
  if (kept.length === 0 && isString(reason)) {
    // Narrowed by the message catalog at runtime; an unknown reason falls back to generic there.
    result.reason = reason as BookableTimes["reason"];
  }
  return result;
}

function parseConfirmation(body: unknown): Confirmation | null {
  if (!isRecord(body)) return null;
  const { date, startTime, endTime, partySize, guest } = body;
  if (
    !isString(date) ||
    !isString(startTime) ||
    !isString(endTime) ||
    !isNumber(partySize) ||
    !isRecord(guest) ||
    !isString(guest.name)
  ) {
    return null;
  }
  return { date, startTime, endTime, partySize, guestName: guest.name };
}

function parseCancellation(body: unknown): CancellationDone | null {
  if (!isRecord(body)) return null;
  const { date, startTime, endTime, partySize } = body;
  if (!isString(date) || !isString(startTime) || !isString(endTime) || !isNumber(partySize)) {
    return null;
  }
  return { date, startTime, endTime, partySize };
}

interface ParsedError {
  code: string;
  details: unknown;
}

function parseError(body: unknown): ParsedError | null {
  if (!isRecord(body) || !isRecord(body.error) || !isString(body.error.code)) return null;
  return { code: body.error.code, details: body.error.details };
}

function fieldNames(details: unknown): FieldProblem[] {
  if (!Array.isArray(details)) return ["form"];
  const names: FieldProblem[] = [];
  for (const item of details as unknown[]) {
    const field = isRecord(item) && isString(item.field) ? item.field : "";
    const name: FieldProblem = BOOKING_FIELDS.includes(field) ? (field as BookingField) : "form";
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? names : ["form"];
}

function reasonOf(details: unknown): string {
  return isRecord(details) && isString(details.reason) ? details.reason : "";
}

export function createApiClient(options: ClientOptions): ApiClient {
  const { baseUrl, timeoutMs = 8000 } = options;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function send(
    path: string,
    init: { method: "GET" } | { method: "POST"; body: unknown },
    callerSignal?: AbortSignal,
  ): Promise<Outcome> {
    const controller = new AbortController();
    const state = { timedOut: false };
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => {
      controller.abort();
    };
    if (callerSignal?.aborted) {
      clearTimeout(timer);
      return { kind: "aborted" };
    }
    callerSignal?.addEventListener("abort", onCallerAbort);
    try {
      const response = await doFetch(`${baseUrl}${path}`, {
        method: init.method,
        headers: init.method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { kind: "http", status: response.status, body };
    } catch {
      if (callerSignal?.aborted && !state.timedOut) return { kind: "aborted" };
      return { kind: "unreachable" };
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** Applies classification rules 1-5; `onSuccess` maps a 2xx body, `onRefusal` a typed 4xx. */
  function classify<T, R>(
    outcome: Outcome,
    onSuccess: (body: unknown) => T | null,
    onRefusal: (error: ParsedError) => R,
  ): ApiResult<T, R> | Aborted {
    if (outcome.kind === "aborted") return outcome;
    if (outcome.kind === "unreachable") return { kind: "unreachable" };
    const { status, body } = outcome;
    if (status >= 500) return { kind: "serverError" };
    if (status >= 200 && status < 300) {
      const value = onSuccess(body);
      return value === null ? { kind: "serverError" } : { kind: "success", value };
    }
    if (status >= 400) {
      const error = parseError(body);
      return error === null ? { kind: "serverError" } : { kind: "refusal", refusal: onRefusal(error) };
    }
    return { kind: "serverError" };
  }

  return {
    async getTimes(query, signal) {
      const search = new URLSearchParams({
        date: query.date,
        partySize: String(query.partySize),
      });
      const outcome = await send(`/availability/times?${search.toString()}`, { method: "GET" }, signal);
      return classify<BookableTimes, TimesRefusal>(outcome, parseTimes, (error) =>
        error.code === "VALIDATION_ERROR"
          ? { code: "VALIDATION_ERROR", fields: fieldNames(error.details) }
          : { code: error.code },
      );
    },

    async createReservation(input, signal) {
      const outcome = await send("/reservations", { method: "POST", body: input }, signal);
      return classify<Confirmation, CreateRefusal>(outcome, parseConfirmation, (error) => {
        if (error.code === "VALIDATION_ERROR") {
          return { code: "VALIDATION_ERROR", fields: fieldNames(error.details) };
        }
        if (error.code === "CONFLICT") return { code: "CONFLICT", reason: reasonOf(error.details) };
        if (error.code === "NO_AVAILABILITY") {
          return { code: "NO_AVAILABILITY", reason: reasonOf(error.details) };
        }
        return { code: error.code };
      });
    },

    async cancelReservation(input, signal) {
      const outcome = await send("/reservations/cancel", { method: "POST", body: input }, signal);
      return classify<CancellationDone, CancelRefusal>(outcome, parseCancellation, (error) => ({
        code: error.code,
      }));
    },
  };
}
