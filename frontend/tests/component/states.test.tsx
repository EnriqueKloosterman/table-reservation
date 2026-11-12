import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGES } from "../../src/api/messages";
import { navigate } from "../../src/shared/router";
import { chooseDateAndParty } from "../support/booking-helpers";
import { deferred, type Deferred } from "../support/deferred";
import { FakeApiClient, type TimesResult } from "../support/fake-api-client";
import { cancelOk, timesOk } from "../support/fixtures";
import { renderApp } from "../support/render-app";

const TECHNICAL = /\b(500|502|503|404|409|422|fetch|network|exception|undefined|json|stack|ECONN)\b/i;

function noTechnicalText() {
  expect(document.body.textContent).not.toMatch(TECHNICAL);
}

async function timesIn(state: "loading" | "error" | "unreachable") {
  const client = new FakeApiClient();
  const gate: Deferred<void> = deferred();
  const result: TimesResult =
    state === "error"
      ? { kind: "serverError" }
      : state === "unreachable"
        ? { kind: "unreachable" }
        : timesOk();
  client.script(client.times, result);
  if (state === "loading") client.gate(client.times, gate);
  const view = renderApp({ client });
  const user = userEvent.setup();
  await chooseDateAndParty(user);
  return { client, user, gate, view };
}

describe("times region states (FR-027)", () => {
  it("loading shows progress text and no failure", async () => {
    await timesIn("loading");
    expect(await screen.findByText(/Loading the available times/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    noTechnicalText();
  });

  it("server error: plain text and a retry", async () => {
    await timesIn("error");
    expect((await screen.findAllByText(CLIENT_MESSAGES.timesServerError.title)).length).toBeGreaterThan(0);
    expect(screen.queryByText(CLIENT_MESSAGES.timesUnreachable.title)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    noTechnicalText();
  });

  it("unreachable: its own text and a retry", async () => {
    await timesIn("unreachable");
    expect((await screen.findAllByText(CLIENT_MESSAGES.timesUnreachable.title)).length).toBeGreaterThan(0);
    expect(screen.queryByText(CLIENT_MESSAGES.timesServerError.title)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    noTechnicalText();
    expect(CLIENT_MESSAGES.timesUnreachable.title).not.toBe(CLIENT_MESSAGES.timesServerError.title);
  });

  it("the retry control asks again", async () => {
    const { client, user } = await timesIn("unreachable");
    client.script(client.times, { kind: "unreachable" }, timesOk());
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(client.times.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("an in-flight times answer is ignored after the other destination was opened", async () => {
    const { gate } = await timesIn("loading");
    await screen.findByText(/Loading the available times/);
    act(() => {
      navigate("/cancel");
    });
    await screen.findByRole("heading", { level: 1, name: "Cancel your reservation" });
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    expect(within(screen.getByRole("status")).queryByText("Available times loaded.")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});

describe("cancel button states (FR-027)", () => {
  it("loading disables the button and shows busy text", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.cancel, cancelOk()).gate(client.cancel, gate);
    renderApp({ client, path: "/cancel", initialCancelCode: "CODE-1234" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel my reservation" }));
    const busy = await screen.findByRole("button", { name: "Cancelling..." });
    expect(busy).toBeDisabled();
    noTechnicalText();
    gate.resolve();
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
  });

  it.each([
    ["server error", { kind: "serverError" } as const],
    ["unreachable", { kind: "unreachable" } as const],
  ])("%s: plain temporary-failure text with a retry, no technical text", async (_name, result) => {
    const client = new FakeApiClient();
    client.script(client.cancel, result, cancelOk());
    renderApp({ client, path: "/cancel", initialCancelCode: "CODE-1234" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel my reservation" }));
    expect((await screen.findAllByText(CLIENT_MESSAGES.cancelTemporary.title)).length).toBeGreaterThan(0);
    noTechnicalText();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
  });

  it("an in-flight cancellation answer is ignored after the booking page was opened", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.cancel, cancelOk()).gate(client.cancel, gate);
    renderApp({ client, path: "/cancel", initialCancelCode: "CODE-1234" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel my reservation" }));
    await screen.findByRole("button", { name: "Cancelling..." });
    act(() => {
      navigate("/");
    });
    await screen.findByRole("heading", { level: 1, name: "Book a table" });
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).queryByText(CLIENT_MESSAGES.cancelled.title),
    ).not.toBeInTheDocument();
  });
});
