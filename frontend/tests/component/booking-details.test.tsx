import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakeApiClient } from "../support/fake-api-client";
import { renderApp } from "../support/render-app";
import { chooseDateAndParty, fillDetails, pickTime } from "../support/booking-helpers";
import { DATE, DATE_TEXT, createOk, timesOk } from "../support/fixtures";

function setup() {
  const client = new FakeApiClient();
  client.script(client.times, timesOk());
  client.script(client.create, createOk());
  renderApp({ client });
  return { client, user: userEvent.setup() };
}

describe("booking page - details form", () => {
  it("is hidden until a time is chosen, then shows labelled fields and a summary (FR-006)", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    await screen.findAllByRole("radio");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await pickTime(user, "20:00");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
    const summary = screen.getByRole("group", { name: "Your booking" });
    expect(within(summary).getByText(DATE_TEXT)).toBeInTheDocument();
    expect(within(summary).getByText("20:00")).toBeInTheDocument();
    expect(within(summary).getByText("4")).toBeInTheDocument();
  });

  it("keeps the typed details when the time changes", async () => {
    const { user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    await fillDetails(user);
    await pickTime(user, "20:30");
    expect(screen.getByLabelText("Name")).toHaveValue("Ana Perez");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Phone")).toHaveValue("+34 600 123 456");
    expect(
      within(screen.getByRole("group", { name: "Your booking" })).getByText("20:30"),
    ).toBeInTheDocument();
  });

  it("shows each problem next to its field, focuses the summary, keeps values, sends nothing", async () => {
    const { client, user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const name = screen.getByLabelText("Name");
    const email = screen.getByLabelText("Email");
    const phone = screen.getByLabelText("Phone");
    expect(name).toBeInvalid();
    expect(name).toHaveAccessibleDescription("Error: Enter your name (up to 100 characters).");
    expect(email).toBeInvalid();
    expect(email).toHaveAccessibleDescription(
      "Error: Enter a valid email address (up to 254 characters).",
    );
    expect(phone).toBeInvalid();
    expect(phone).toHaveAccessibleDescription(/^Error: Enter a phone number/);
    expect(email).toHaveValue("not-an-email");
    expect(screen.getByRole("region", { name: "There is a problem" })).toHaveFocus();
    expect(client.create.calls).toHaveLength(0);
  });

  it("trims values and sends the party size as a number", async () => {
    const { client, user } = setup();
    await chooseDateAndParty(user);
    await pickTime(user, "20:00");
    await fillDetails(user, {
      name: "  Ana Perez  ",
      email: " ana@example.com ",
      phone: " +34 600 123 456 ",
    });
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("heading", { level: 1, name: "Your table is booked" });
    expect(client.create.calls).toEqual([
      {
        date: DATE,
        time: "20:00",
        partySize: 4,
        name: "Ana Perez",
        email: "ana@example.com",
        phone: "+34 600 123 456",
      },
    ]);
  });
});
