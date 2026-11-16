import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGES, ERROR_CODE_MESSAGES } from "../../src/api/messages";
import { navigate } from "../../src/shared/router";
import { bookUpTo, chooseDateAndParty, pickTime } from "../support/booking-helpers";
import { FakeApiClient } from "../support/fake-api-client";
import { cancelOk, cancelRefused, createOk, timesOk } from "../support/fixtures";
import { renderApp } from "../support/render-app";

const SUFFIX = " - Table reservation";

function landmarks() {
  expect(document.querySelectorAll("header")).toHaveLength(1);
  expect(document.querySelectorAll("main")).toHaveLength(1);
  expect(document.querySelectorAll("footer")).toHaveLength(1);
}

function oneH1(name: string) {
  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(name);
  return headings[0] as HTMLElement;
}

function bookingClient() {
  const client = new FakeApiClient();
  client.script(client.times, timesOk()).script(client.create, createOk());
  return client;
}

describe("structure, titles and focus", () => {
  it("booking page: one h1, landmarks, title with the step", () => {
    renderApp({ client: bookingClient() });
    oneH1("Book a table");
    landmarks();
    expect(document.title).toBe(`Book a table${SUFFIX}`);
  });

  it("confirmation: title, one h1 and focus", async () => {
    renderApp({ client: bookingClient() });
    const user = userEvent.setup();
    await bookUpTo(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    const h1 = await screen.findByRole("heading", { level: 1, name: "Your table is booked" });
    expect(oneH1("Your table is booked")).toBe(h1);
    expect(h1).toHaveFocus();
    expect(document.title).toBe(`Your table is booked${SUFFIX}`);
    landmarks();
  });

  it("time selected: focus stays on the time (arrow keys keep working) and the form is announced", async () => {
    renderApp({ client: bookingClient() });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    await screen.findByRole("heading", { name: "Your details" });
    expect(screen.getByRole("radio", { name: /20:00/ })).toHaveFocus();
    await waitFor(() => {
      expect(
        within(screen.getByRole("status")).getByText("Your details section is ready below the times."),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("failed validation: focus goes to the error summary", async () => {
    renderApp({ client: bookingClient() });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    const summary = await screen.findByRole("region", { name: "There is a problem" });
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
  });

  it("neutral changes go to the status region", async () => {
    renderApp({ client: bookingClient() });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    await waitFor(() => {
      expect(within(screen.getByRole("status")).getByText("Available times loaded.")).toBeInTheDocument();
    });
  });

  it("cancellation page: title, one h1, landmarks", () => {
    renderApp({ client: new FakeApiClient(), path: "/cancel", initialCancelCode: "CODE-1234" });
    oneH1("Cancel your reservation");
    landmarks();
    expect(document.title).toBe(`Cancel your reservation${SUFFIX}`);
  });

  it("cancellation page without a code: title and one h1", () => {
    renderApp({ client: new FakeApiClient(), path: "/cancel" });
    oneH1("Cancel your reservation");
    expect(document.title).toBe(`Cancel your reservation${SUFFIX}`);
  });

  it.each([
    ["cancelled", cancelOk(), CLIENT_MESSAGES.cancelled.title],
    ["already cancelled", cancelRefused("ALREADY_CANCELLED"), ERROR_CODE_MESSAGES.ALREADY_CANCELLED.title],
    ["cannot cancel", cancelRefused("CANNOT_CANCEL"), ERROR_CODE_MESSAGES.CANNOT_CANCEL.title],
    ["not found", cancelRefused("NOT_FOUND"), ERROR_CODE_MESSAGES.NOT_FOUND.title],
  ])("outcome %s: focus, one h1, title, status region", async (_name, result, title) => {
    const client = new FakeApiClient();
    client.script(client.cancel, result);
    renderApp({ client, path: "/cancel", initialCancelCode: "CODE-1234" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel my reservation" }));
    const h1 = await screen.findByRole("heading", { level: 1, name: title });
    expect(oneH1(title)).toBe(h1);
    expect(h1).toHaveFocus();
    expect(document.title).toBe(`${title}${SUFFIX}`);
    expect(within(screen.getByRole("status")).getByText(title)).toBeInTheDocument();
    landmarks();
  });

  it("the title follows the page when navigating", () => {
    renderApp({ client: new FakeApiClient() });
    expect(document.title).toBe(`Book a table${SUFFIX}`);
    act(() => {
      navigate("/cancel");
    });
    expect(document.title).toBe(`Cancel your reservation${SUFFIX}`);
  });

  it("failures go to the alert region", async () => {
    const client = new FakeApiClient();
    client.script(client.times, { kind: "serverError" });
    renderApp({ client });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    await waitFor(() => {
      expect(
        within(screen.getByRole("alert")).getByText(CLIENT_MESSAGES.timesServerError.title),
      ).toBeInTheDocument();
    });
  });
});

describe("labels and language", () => {
  it("every input has a visible label and nothing relies on title or select", async () => {
    renderApp({ client: bookingClient() });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    await screen.findByLabelText("Name");
    for (const input of document.querySelectorAll("input")) {
      const labels = input.labels;
      expect(labels?.length).toBeGreaterThan(0);
      expect(labels?.[0]?.textContent.trim()).not.toBe("");
    }
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
  });

  it("is English only: html lang, no language switcher", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/<html\s+lang="en"/);
    renderApp({ client: new FakeApiClient() });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/language|idioma|español/i)).not.toBeInTheDocument();
  });
});
