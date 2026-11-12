import type { Page, Route } from "@playwright/test";

export const API = "http://127.0.0.1:3999";
export const SECRET = "SECRET-CODE-9f3a7c";
export const DATE = "2026-11-14";

export type Reply =
  | { status: number; body: unknown; delayMs?: number }
  | { abort: true }
  /** Never answers (the request stays open until the page gives up). */
  | { never: true };

export interface Scenario {
  times?: Reply;
  create?: Reply;
  cancel?: Reply;
}

export const TIMES_OK: Reply = {
  status: 200,
  body: {
    date: DATE,
    partySize: 4,
    periods: [
      { name: "Lunch", times: ["13:00", "13:30"] },
      { name: "Dinner", times: ["20:00", "20:30", "23:30"] },
    ],
  },
};

export const TIMES_EMPTY: Reply = {
  status: 200,
  body: { date: DATE, partySize: 4, periods: [], reason: "closed_day" },
};

export const CREATE_OK: Reply = {
  status: 201,
  body: {
    id: "res-1",
    secretCode: SECRET,
    date: DATE,
    startTime: "23:30",
    endTime: "01:00",
    partySize: 4,
    table: { id: "t1", name: "Table 7" },
    guest: { name: "Ana Perez", email: "ana@example.com", phone: "+34 600 123 456" },
    createdAt: "2026-11-12T10:00:00.000Z",
  },
};

export const CANCEL_OK: Reply = {
  status: 200,
  body: { date: DATE, startTime: "20:00", endTime: "21:30", partySize: 4 },
};

export function errorReply(status: number, code: string, details?: unknown): Reply {
  return { status, body: { error: { code, message: "x", ...(details === undefined ? {} : { details }) } } };
}

export const SERVER_ERROR: Reply = errorReply(500, "INTERNAL_ERROR");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function answer(route: Route, reply: Reply | undefined): Promise<void> {
  if (reply === undefined) {
    await route.fulfill({ status: 500, headers: CORS, contentType: "application/json", body: "{}" });
    return;
  }
  if ("abort" in reply) {
    await route.abort("connectionrefused");
    return;
  }
  if ("never" in reply) return;
  if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
  await route.fulfill({
    status: reply.status,
    headers: CORS,
    contentType: "application/json",
    body: JSON.stringify(reply.body),
  });
}

/** Answers the three API operations at the fixed test address; every other request is untouched. */
export async function mockApi(page: Page, scenario: Scenario): Promise<{ requests: string[] }> {
  const requests: string[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const { pathname } = new URL(request.url());
    requests.push(`${request.method()} ${pathname}`);
    if (pathname === "/availability/times") await answer(route, scenario.times);
    else if (pathname === "/reservations") await answer(route, scenario.create);
    else if (pathname === "/reservations/cancel") await answer(route, scenario.cancel);
    else await route.fulfill({ status: 404, headers: CORS, contentType: "application/json", body: "{}" });
  });
  return { requests };
}
