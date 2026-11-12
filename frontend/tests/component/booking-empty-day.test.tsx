import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AVAILABILITY_MESSAGES, CLIENT_MESSAGES, GENERIC_MESSAGE } from "../../src/api/messages";
import type { AvailabilityReason } from "../../src/api/types";
import { FakeApiClient } from "../support/fake-api-client";
import { renderApp } from "../support/render-app";
import { chooseDateAndParty, findVisibleText, visibleText } from "../support/booking-helpers";
import { DATE, timesEmpty, timesOk } from "../support/fixtures";

const REASONS = Object.keys(AVAILABILITY_MESSAGES) as AvailabilityReason[];

function setup(client: FakeApiClient) {
  renderApp({ client });
  return userEvent.setup();
}

function expectMessage(message: { title: string; body: string; next?: string }) {
  expect(visibleText(message.title)).toHaveLength(1);
  expect(visibleText(message.body)).toHaveLength(1);
  if (message.next) expect(visibleText(message.next)).toHaveLength(1);
}

describe("booking page - empty day (FR-004, SC-003)", () => {
  it("covers every availability reason of the catalog", () => {
    expect(REASONS).toHaveLength(7);
  });

  it.each(REASONS)("shows the own message and next step for %s", async (reason) => {
    const client = new FakeApiClient();
    client.script(client.times, timesEmpty(reason));
    const user = setup(client);
    await chooseDateAndParty(user);

    expectMessage(await findMessage(reason));
    // Editable on the same page, nothing technical visible.
    expect(screen.getByLabelText("Date")).toBeEnabled();
    expect(screen.getByLabelText("Party size")).toBeEnabled();
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{3}\b/);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows pairwise distinct messages for the reasons", () => {
    const titles = new Set(REASONS.map((reason) => AVAILABILITY_MESSAGES[reason].body));
    expect(titles.size).toBe(REASONS.length);
  });

  it("announces the empty answer in the polite region", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesEmpty("closed_day"));
    const user = setup(client);
    await chooseDateAndParty(user);
    await findMessage("closed_day");
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });

  it("shows the generic message with a retry when there is no period and no reason (FR-002)", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesEmpty(), timesOk());
    const user = setup(client);
    await chooseDateAndParty(user);

    expect(await findVisibleText(GENERIC_MESSAGE.title)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: /20:00/ })).toBeInTheDocument();
    expect(client.times.calls).toEqual([
      { date: DATE, partySize: 4 },
      { date: DATE, partySize: 4 },
    ]);
  });

  it("shows the generic message with a retry for an unknown reason", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesEmpty("brand_new_reason"));
    const user = setup(client);
    await chooseDateAndParty(user);

    expect(await findVisibleText(GENERIC_MESSAGE.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("brand_new_reason")).not.toBeInTheDocument();
  });
});

describe("booking page - failures while loading times", () => {
  it("shows the server error message with a retry that asks for the same query", async () => {
    const client = new FakeApiClient();
    client.script(client.times, { kind: "serverError" }, timesOk());
    const user = setup(client);
    await chooseDateAndParty(user);

    expect(await findVisibleText(CLIENT_MESSAGES.timesServerError.title)).toBeInTheDocument();
    expect(visibleText(CLIENT_MESSAGES.timesUnreachable.title)).toHaveLength(0);
    expect(within(screen.getByRole("alert")).getByText(CLIENT_MESSAGES.timesServerError.title)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: /13:00/ })).toBeInTheDocument();
    expect(client.times.calls).toHaveLength(2);
    expect(client.times.calls[1]).toEqual(client.times.calls[0]);
  });

  it("shows the distinct unreachable message with a retry", async () => {
    const client = new FakeApiClient();
    client.script(client.times, { kind: "unreachable" }, timesOk());
    const user = setup(client);
    await chooseDateAndParty(user);

    expect(await findVisibleText(CLIENT_MESSAGES.timesUnreachable.title)).toBeInTheDocument();
    expect(visibleText(CLIENT_MESSAGES.timesServerError.title)).toHaveLength(0);
    expect(within(screen.getByRole("alert")).getByText(CLIENT_MESSAGES.timesUnreachable.title)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(client.times.calls).toHaveLength(2);
    });
    expect(await screen.findByRole("radio", { name: /13:00/ })).toBeInTheDocument();
  });

  it("shows the form-level generic message for a VALIDATION_ERROR on times", async () => {
    const client = new FakeApiClient();
    client.script(client.times, {
      kind: "refusal",
      refusal: { code: "VALIDATION_ERROR", fields: ["date"] },
    });
    const user = setup(client);
    await chooseDateAndParty(user);

    expect(await findVisibleText("Please check the details and try again.")).toBeInTheDocument();
    expect(screen.queryByText("date")).not.toBeInTheDocument();
  });
});

async function findMessage(reason: AvailabilityReason) {
  const message = AVAILABILITY_MESSAGES[reason];
  await findVisibleText(message.title);
  return message;
}
