import type { Page } from "@playwright/test";
import {
  CANCEL_OK,
  CREATE_OK,
  SERVER_ERROR,
  TIMES_EMPTY,
  TIMES_OK,
  errorReply,
  mockApi,
  DATE,
  type Scenario,
} from "./mock-api";

export const CONFIG_BASE_URL = "http://127.0.0.1:4174";

export interface Screen {
  name: string;
  /** Opens the screen and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

export async function chooseDateAndParty(page: Page): Promise<void> {
  await page.getByLabel("Date").fill(DATE);
  await page.getByLabel("Party size").fill("4");
}

export async function fillDetails(page: Page): Promise<void> {
  await page.getByLabel("Name").fill("Ana Perez");
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("Phone").fill("+34 600 123 456");
}

async function booking(page: Page, scenario: Scenario, until: "times" | "details" | "form" | "submit") {
  await mockApi(page, scenario);
  await page.goto("/");
  await chooseDateAndParty(page);
  if (until === "times") return;
  await page.getByRole("radio", { name: /20:00/ }).check();
  await page.getByRole("heading", { name: "Your details" }).waitFor();
  if (until === "details") return;
  if (until === "form") {
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.getByRole("region", { name: "There is a problem" }).waitFor();
    return;
  }
  await fillDetails(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
}

async function cancelling(page: Page, reply: Scenario["cancel"], withCode = true) {
  await mockApi(page, { cancel: reply });
  await page.goto(withCode ? "/cancel#code=SECRET123" : "/cancel");
  await page.getByRole("heading", { level: 1, name: "Cancel your reservation" }).waitFor();
}

async function cancelOutcome(page: Page, reply: Scenario["cancel"], heading: string) {
  await cancelling(page, reply);
  await page.getByRole("button", { name: "Cancel my reservation" }).click();
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
}

/** Every screen and state of the contracts/ui-routes.md screens table that the app can show. */
export const SCREENS: Screen[] = [
  {
    name: "config",
    open: async (page) => {
      await page.goto(`${CONFIG_BASE_URL}/`);
      await page.getByRole("heading", { level: 1, name: "Service not available" }).waitFor();
    },
  },
  {
    name: "idle",
    open: async (page) => {
      await mockApi(page, {});
      await page.goto("/");
      await page.getByText("Choose a date and a party size").waitFor();
    },
  },
  {
    name: "times loading",
    open: async (page) => {
      await booking(page, { times: { never: true } }, "times");
      await page.getByText(/Loading the available times/).waitFor();
    },
  },
  {
    name: "times ready",
    open: async (page) => {
      await booking(page, { times: TIMES_OK }, "times");
      await page.getByRole("radio", { name: /20:00/ }).waitFor();
    },
  },
  {
    name: "times empty (one reason)",
    open: async (page) => {
      await booking(page, { times: TIMES_EMPTY }, "times");
      await page.getByText("Closed on that day.").waitFor();
    },
  },
  {
    name: "times error",
    open: async (page) => {
      await booking(page, { times: SERVER_ERROR }, "times");
      await page.getByRole("button", { name: "Try again" }).waitFor();
    },
  },
  {
    name: "times unreachable",
    open: async (page) => {
      await booking(page, { times: { abort: true } }, "times");
      await page.getByRole("button", { name: "Try again" }).waitFor();
    },
  },
  {
    name: "details",
    open: async (page) => {
      await booking(page, { times: TIMES_OK }, "details");
    },
  },
  {
    name: "field problems",
    open: async (page) => {
      await booking(page, { times: TIMES_OK }, "form");
    },
  },
  {
    name: "submitting",
    open: async (page) => {
      await booking(page, { times: TIMES_OK, create: { never: true } }, "submit");
      await page.getByRole("button", { name: "Booking..." }).waitFor();
    },
  },
  {
    name: "refusal",
    open: async (page) => {
      await booking(
        page,
        {
          times: TIMES_OK,
          create: errorReply(409, "CONFLICT", { reason: "duplicate_reservation" }),
        },
        "submit",
      );
      await page.getByText("You already have a reservation.").first().waitFor();
    },
  },
  {
    name: "unknown outcome",
    open: async (page) => {
      await booking(page, { times: TIMES_OK, create: { abort: true } }, "submit");
      await page.getByText(/We don't know whether your reservation was made/).first().waitFor();
    },
  },
  {
    name: "confirmation",
    open: async (page) => {
      await booking(page, { times: TIMES_OK, create: CREATE_OK }, "submit");
      await page.getByRole("heading", { level: 1, name: "Your table is booked" }).waitFor();
    },
  },
  { name: "cancel ready", open: (page) => cancelling(page, CANCEL_OK) },
  { name: "cancel no code", open: (page) => cancelling(page, CANCEL_OK, false) },
  {
    name: "cancel outcome: cancelled",
    open: (page) => cancelOutcome(page, CANCEL_OK, "Your reservation is cancelled"),
  },
  {
    name: "cancel outcome: already cancelled",
    open: (page) =>
      cancelOutcome(
        page,
        errorReply(409, "ALREADY_CANCELLED"),
        "This reservation was already cancelled.",
      ),
  },
  {
    name: "cancel outcome: cannot cancel",
    open: (page) =>
      cancelOutcome(
        page,
        errorReply(409, "CANNOT_CANCEL"),
        "This reservation can no longer be cancelled online.",
      ),
  },
  {
    name: "cancel outcome: not found",
    open: (page) =>
      cancelOutcome(page, errorReply(404, "NOT_FOUND"), "We couldn't find that reservation."),
  },
];
