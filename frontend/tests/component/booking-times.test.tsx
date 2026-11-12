import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeApiClient } from "../support/fake-api-client";
import { renderApp } from "../support/render-app";
import { chooseDateAndParty, pickTime } from "../support/booking-helpers";
import { DATE, DATE_TEXT, PERIODS, timesOk } from "../support/fixtures";
import { deferred, type Deferred } from "../support/deferred";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const client = new FakeApiClient();
  client.script(client.times, timesOk());
  renderApp({ client });
  return { client, user: userEvent.setup() };
}

describe("booking page - choosing a time", () => {
  it("starts empty, shows the prompt and makes no request (FR-001)", () => {
    const { client } = setup();
    expect(screen.getByLabelText("Date")).toHaveValue("");
    expect(screen.getByLabelText("Party size")).toHaveValue("");
    expect(
      screen.getByText("Choose a date and a party size to see the available times."),
    ).toBeInTheDocument();
    expect(client.times.calls).toHaveLength(0);
  });

  it("puts no min or max on the date input; the server is the only authority on dates", () => {
    setup();
    const date = screen.getByLabelText("Date");
    expect(date).not.toHaveAttribute("min");
    expect(date).not.toHaveAttribute("max");
  });

  it("has exactly one h1 'Book a table'", () => {
    setup();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
  });

  it("makes no call with only one of the two inputs, one call with both", async () => {
    const { client, user } = setup();
    await user.type(screen.getByLabelText("Date"), DATE);
    expect(client.times.calls).toHaveLength(0);
    await user.type(screen.getByLabelText("Party size"), "4");
    await waitFor(() => {
      expect(client.times.calls).toEqual([{ date: DATE, partySize: 4 }]);
    });
  });

  it("requests immediately, with no debounce or artificial delay (SC-002)", () => {
    vi.useFakeTimers();
    const client = new FakeApiClient();
    client.script(client.times, timesOk());
    renderApp({ client });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: DATE } });
    fireEvent.change(screen.getByLabelText("Party size"), { target: { value: "4" } });
    expect(client.times.calls).toEqual([{ date: DATE, partySize: 4 }]);
  });

  it("groups times under the returned period names, in the returned order (FR-002)", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    const lunch = await screen.findByRole("group", { name: "Lunch" });
    const dinner = screen.getByRole("group", { name: "Dinner" });
    const lunchTimes = within(lunch)
      .getAllByRole("radio")
      .map((r) => r.closest("label")?.textContent ?? "");
    expect(lunchTimes[0]).toContain("13:00");
    expect(lunchTimes[1]).toContain("13:30");
    expect(within(dinner).getAllByRole("radio")).toHaveLength(2);
    expect(lunch.compareDocumentPosition(dinner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not show an empty period", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesOk([{ name: "Lunch", times: [] }, ...PERIODS.slice(1)]));
    renderApp({ client });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    await screen.findByRole("group", { name: "Dinner" });
    expect(screen.queryByRole("group", { name: "Lunch" })).not.toBeInTheDocument();
  });

  it("offers radios with none preselected; only one can be selected (FR-005)", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(4);
    for (const radio of radios) expect(radio).not.toBeChecked();
    await user.click(screen.getByRole("radio", { name: /13:30/ }));
    await user.click(screen.getByRole("radio", { name: /20:00/ }));
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /20:00/ })).toBeChecked();
  });

  it("selects with the keyboard (arrows move across periods)", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    const first = await screen.findByRole("radio", { name: /13:00/ });
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /13:30/ })).toBeChecked();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /20:00/ })).toBeChecked();
  });

  it("marks the selected time with a check mark and a thicker-border class, not only colour", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:30");
    const label = screen.getByRole("radio", { name: /20:30/ }).closest("label");
    expect(label).toHaveClass("time-choice--selected");
    expect(label?.textContent).toContain("✓");
    const other = screen.getByRole("radio", { name: /20:00/ }).closest("label");
    expect(other).not.toHaveClass("time-choice--selected");
    expect(other?.textContent).not.toContain("✓");
  });

  it("clears the selected time and requests again when the party size changes", async () => {
    const { client, user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    expect(screen.getByRole("radio", { name: /20:00/ })).toBeChecked();
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "2");
    await waitFor(() => {
      expect(client.times.calls.at(-1)).toEqual({ date: DATE, partySize: 2 });
    });
    for (const radio of await screen.findAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("clears the selected time and requests again when the date changes", async () => {
    const { client, user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-15" } });
    await waitFor(() => {
      expect(client.times.calls.at(-1)).toEqual({ date: "2026-11-15", partySize: 4 });
    });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it.each(["0", "51", "2.5"])(
    "party size %s shows the field problem and sends no request",
    async (value) => {
      const { client, user } = setup();
      await user.type(screen.getByLabelText("Date"), DATE);
      fireEvent.change(screen.getByLabelText("Party size"), { target: { value } });
      expect(screen.getByLabelText("Party size")).toBeInvalid();
      expect(screen.getByLabelText("Party size")).toHaveAccessibleDescription(
        "Error: Enter a whole number from 1 to 50.",
      );
      expect(client.times.calls).toHaveLength(0);
    },
  );

  it("shows the loading state with loading text", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.times, timesOk()).gate(client.times, gate);
    renderApp({ client });
    const user = userEvent.setup();
    await chooseDateAndParty(user);
    expect(await screen.findByText(/Loading the available times/)).toBeInTheDocument();
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole("group", { name: "Lunch" })).toBeInTheDocument();
    expect(screen.queryByText(/Loading the available times/)).not.toBeInTheDocument();
  });

  it("shows the formatted date and the times as returned (FR-029)", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    expect(screen.getByText(DATE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /20:00/ })).toBeInTheDocument();
  });
});
