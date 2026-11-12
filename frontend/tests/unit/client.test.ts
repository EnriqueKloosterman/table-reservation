import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client";

const BASE = "http://api.test";

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fakeFetch = vi.fn((input: string, init?: RequestInit) => {
    const call = { url: input, init: init ?? {} };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: BASE, fetch: fakeFetch }), calls };
}

const WIRE_RESERVATION = {
  id: "abc123",
  status: "confirmed",
  secretCode: "SECRET-CODE-VALUE",
  date: "2026-11-14",
  startTime: "20:00",
  endTime: "21:30",
  partySize: 2,
  guest: { name: "Ana Lopez", email: "ana@example.com", phone: "+34 600 123 456" },
  table: { name: "T7" },
  createdAt: "2026-11-01T10:00:00.000Z",
};

const CREATE_INPUT = {
  date: "2026-11-14",
  time: "20:00",
  partySize: 2,
  name: "Ana Lopez",
  email: "ana@example.com",
  phone: "+34 600 123 456",
};

function errorBody(code: string, details?: unknown) {
  return { error: { code, message: "Server wording that must never be shown", details } };
}

describe("request shape", () => {
  it("getTimes builds a GET with the query and safe options", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(200, { date: "2026-11-14", partySize: 2, periods: [{ name: "Dinner", times: ["20:00"] }] }),
    );
    await client.getTimes({ date: "2026-11-14", partySize: 2 });
    const call = calls[0];
    expect(call?.url).toBe(`${BASE}/availability/times?date=2026-11-14&partySize=2`);
    expect(call?.init.method ?? "GET").toBe("GET");
    expect(call?.init.credentials).toBe("omit");
    expect(call?.init.cache).toBe("no-store");
    expect(call?.init.referrerPolicy).toBe("no-referrer");
  });

  it("createReservation POSTs JSON to /reservations", async () => {
    const { client, calls } = setup(() => jsonResponse(201, WIRE_RESERVATION));
    await client.createReservation(CREATE_INPUT);
    const call = calls[0];
    expect(call?.url).toBe(`${BASE}/reservations`);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call?.init.body as string)).toEqual(CREATE_INPUT);
    expect(call?.init.credentials).toBe("omit");
    expect(call?.init.cache).toBe("no-store");
    expect(call?.init.referrerPolicy).toBe("no-referrer");
  });

  it("cancelReservation sends the code only in the body", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(200, {
        id: "x",
        status: "cancelled",
        date: "2026-11-14",
        startTime: "20:00",
        endTime: "21:30",
        partySize: 2,
        cancelledAt: "2026-11-02T10:00:00.000Z",
      }),
    );
    await client.cancelReservation({ code: "CODE-123" });
    const call = calls[0];
    expect(call?.url).toBe(`${BASE}/reservations/cancel`);
    expect(call?.url).not.toContain("CODE-123");
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call?.init.body as string)).toEqual({ code: "CODE-123" });
    expect(call?.init.credentials).toBe("omit");
    expect(call?.init.cache).toBe("no-store");
    expect(call?.init.referrerPolicy).toBe("no-referrer");
  });
});

describe("classification", () => {
  it("maps a rejected fetch to unreachable", async () => {
    const client = createApiClient({
      baseUrl: BASE,
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    expect(await client.getTimes({ date: "2026-11-14", partySize: 2 })).toEqual({ kind: "unreachable" });
    expect(await client.createReservation(CREATE_INPUT)).toEqual({ kind: "unreachable" });
    expect(await client.cancelReservation({ code: "c" })).toEqual({ kind: "unreachable" });
  });

  describe("timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("maps an 8 s silence to unreachable", async () => {
      const neverAnswers = (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      const client = createApiClient({ baseUrl: BASE, fetch: neverAnswers });
      const pending = client.getTimes({ date: "2026-11-14", partySize: 2 });
      await vi.advanceTimersByTimeAsync(7999);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toEqual({ kind: "unreachable" });
    });
  });

  it("maps a caller abort to aborted", async () => {
    const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = createApiClient({ baseUrl: BASE, fetch: hanging });
    const controller = new AbortController();
    const pending = client.getTimes({ date: "2026-11-14", partySize: 2 }, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ kind: "aborted" });
  });

  it.each([500, 503])("maps HTTP %i to serverError", async (status) => {
    const { client } = setup(() => jsonResponse(status, errorBody("SERVICE_UNAVAILABLE")));
    expect(await client.getTimes({ date: "2026-11-14", partySize: 2 })).toEqual({ kind: "serverError" });
    expect(await client.createReservation(CREATE_INPUT)).toEqual({ kind: "serverError" });
    expect(await client.cancelReservation({ code: "c" })).toEqual({ kind: "serverError" });
  });

  it.each([
    ["not json", () => new Response("<html>", { status: 200 })],
    ["wrong shape", () => jsonResponse(200, { hello: "world" })],
    ["null", () => jsonResponse(200, null)],
  ])("maps a 2xx with %s to serverError", async (_label, make) => {
    const { client } = setup(make);
    expect(await client.getTimes({ date: "2026-11-14", partySize: 2 })).toEqual({ kind: "serverError" });
    expect(await client.createReservation(CREATE_INPUT)).toEqual({ kind: "serverError" });
    expect(await client.cancelReservation({ code: "c" })).toEqual({ kind: "serverError" });
  });

  it("maps a 4xx with another body to serverError", async () => {
    const { client } = setup(() => new Response("nope", { status: 418 }));
    expect(await client.createReservation(CREATE_INPUT)).toEqual({ kind: "serverError" });
    const second = setup(() => jsonResponse(400, { something: "else" }));
    expect(await second.client.createReservation(CREATE_INPUT)).toEqual({ kind: "serverError" });
  });

  it("carries an unknown error code string in a refusal", async () => {
    const { client } = setup(() => jsonResponse(409, errorBody("SOMETHING_NEW")));
    expect(await client.createReservation(CREATE_INPUT)).toEqual({
      kind: "refusal",
      refusal: { code: "SOMETHING_NEW" },
    });
  });
});

describe("getTimes", () => {
  it("returns the periods in order", async () => {
    const { client } = setup(() =>
      jsonResponse(200, {
        date: "2026-11-14",
        partySize: 2,
        periods: [
          { name: "Lunch", times: ["12:00", "12:15"] },
          { name: "Dinner", times: ["20:00"] },
        ],
      }),
    );
    expect(await client.getTimes({ date: "2026-11-14", partySize: 2 })).toEqual({
      kind: "success",
      value: {
        date: "2026-11-14",
        partySize: 2,
        periods: [
          { name: "Lunch", times: ["12:00", "12:15"] },
          { name: "Dinner", times: ["20:00"] },
        ],
      },
    });
  });

  it("keeps the reason of an empty answer and drops empty periods defensively", async () => {
    const { client } = setup(() =>
      jsonResponse(200, {
        date: "2026-12-24",
        partySize: 2,
        periods: [{ name: "Lunch", times: [] }],
        reason: "closed_date",
      }),
    );
    expect(await client.getTimes({ date: "2026-12-24", partySize: 2 })).toEqual({
      kind: "success",
      value: { date: "2026-12-24", partySize: 2, periods: [], reason: "closed_date" },
    });
  });

  it("returns a validation refusal with field names only", async () => {
    const { client } = setup(() =>
      jsonResponse(400, errorBody("VALIDATION_ERROR", [{ field: "date", reason: "Bad date text" }])),
    );
    expect(await client.getTimes({ date: "x", partySize: 2 })).toEqual({
      kind: "refusal",
      refusal: { code: "VALIDATION_ERROR", fields: ["date"] },
    });
  });
});

describe("createReservation", () => {
  it("returns only the allow-listed confirmation fields", async () => {
    const { client } = setup(() => jsonResponse(201, WIRE_RESERVATION));
    const result = await client.createReservation(CREATE_INPUT);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(Object.keys(result.value).sort()).toEqual(
      ["date", "endTime", "guestName", "partySize", "startTime"].sort(),
    );
    expect(result.value).toEqual({
      date: "2026-11-14",
      startTime: "20:00",
      endTime: "21:30",
      partySize: 2,
      guestName: "Ana Lopez",
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("SECRET-CODE-VALUE");
    expect(serialised).not.toContain("secretCode");
    expect(serialised).not.toContain("table");
    expect(serialised).not.toContain("ana@example.com");
    expect(serialised).not.toContain("600 123 456");
  });

  it("keeps field names only and maps unknown fields to form", async () => {
    const { client } = setup(() =>
      jsonResponse(
        400,
        errorBody("VALIDATION_ERROR", [
          { field: "email", reason: "Invalid email text" },
          { field: "guest.shoeSize", reason: "Weird" },
        ]),
      ),
    );
    const result = await client.createReservation(CREATE_INPUT);
    expect(result).toEqual({
      kind: "refusal",
      refusal: { code: "VALIDATION_ERROR", fields: ["email", "form"] },
    });
    expect(JSON.stringify(result)).not.toContain("Invalid email text");
  });

  it("carries the typed reason of NO_AVAILABILITY", async () => {
    const { client } = setup(() =>
      jsonResponse(409, errorBody("NO_AVAILABILITY", { reason: "no_table_free" })),
    );
    expect(await client.createReservation(CREATE_INPUT)).toEqual({
      kind: "refusal",
      refusal: { code: "NO_AVAILABILITY", reason: "no_table_free" },
    });
  });

  it("carries the conflict reason of CONFLICT", async () => {
    const { client } = setup(() =>
      jsonResponse(409, errorBody("CONFLICT", { reason: "duplicate_reservation" })),
    );
    expect(await client.createReservation(CREATE_INPUT)).toEqual({
      kind: "refusal",
      refusal: { code: "CONFLICT", reason: "duplicate_reservation" },
    });
  });
});

describe("cancelReservation", () => {
  it("keeps only date, times and party size", async () => {
    const { client } = setup(() =>
      jsonResponse(200, {
        id: "internal-id",
        status: "cancelled",
        date: "2026-11-14",
        startTime: "20:00",
        endTime: "21:30",
        partySize: 4,
        cancelledAt: "2026-11-02T10:00:00.000Z",
      }),
    );
    const result = await client.cancelReservation({ code: "c" });
    expect(result).toEqual({
      kind: "success",
      value: { date: "2026-11-14", startTime: "20:00", endTime: "21:30", partySize: 4 },
    });
  });

  it.each(["NOT_FOUND", "ALREADY_CANCELLED", "CANNOT_CANCEL", "VALIDATION_ERROR"])(
    "returns a typed refusal for %s",
    async (code) => {
      const status = code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" ? 400 : 409;
      const { client } = setup(() => jsonResponse(status, errorBody(code)));
      const result = await client.cancelReservation({ code: "c" });
      expect(result.kind).toBe("refusal");
      if (result.kind === "refusal") expect(result.refusal.code).toBe(code);
    },
  );
});
