import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_MESSAGES,
  CLIENT_MESSAGES,
  CONFLICT_MESSAGES,
  FIELD_PROBLEMS,
  GENERIC_MESSAGE,
} from "../../src/api/messages";
import type { AvailabilityReason } from "../../src/api/types";
import { FakeApiClient, type CreateResult, type TimesResult } from "../support/fake-api-client";
import { renderApp } from "../support/render-app";
import { bookUpTo, findVisibleText, visibleText } from "../support/booking-helpers";
import { DATE, createOk, timesEmpty, timesOk } from "../support/fixtures";

const CONFIRM = { name: "Confirm booking" } as const;
const OTHER_REASONS = (Object.keys(AVAILABILITY_MESSAGES) as AvailabilityReason[]).filter(
  (reason) => reason !== "no_table_free",
);

function refused(refusal: Extract<CreateResult, { kind: "refusal" }>["refusal"]): CreateResult {
  return { kind: "refusal", refusal };
}

/** Books up to the confirm click, with the given scripted answers. */
async function submitWith(create: CreateResult[], times: TimesResult[] = [timesOk(), timesOk()]) {
  const client = new FakeApiClient();
  client.script(client.times, ...times).script(client.create, ...create);
  renderApp({ client });
  const user = userEvent.setup();
  await bookUpTo(user);
  await user.click(screen.getByRole("button", CONFIRM));
  return { client, user };
}

/** No status number, error code or field path may ever be visible. */
function noTechnicalText() {
  const text = document.body.textContent;
  expect(text).not.toMatch(/\b\d{3}\b/);
  expect(text).not.toMatch(/\b[A-Z]+(?:_[A-Z]+)+\b/);
  expect(text).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/);
}

describe("booking page - NO_AVAILABILITY on confirm", () => {
  it("no_table_free: says the time was taken, reloads, clears only the time, keeps the details (SC-008)", async () => {
    const { client, user } = await submitWith([
      refused({ code: "NO_AVAILABILITY", reason: "no_table_free" }),
    ]);

    await findVisibleText(CLIENT_MESSAGES.noTableFreeLeadIn.title);
    await waitFor(() => {
      expect(client.times.calls).toHaveLength(2);
    });
    expect(client.times.calls[1]).toEqual({ date: DATE, partySize: 4 });
    expect(
      within(screen.getByRole("alert")).getByText(CLIENT_MESSAGES.noTableFreeLeadIn.title),
    ).toBeInTheDocument();

    const radios = await screen.findAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) expect(radio).not.toBeChecked();
    expect(screen.getByLabelText("Date")).toHaveValue(DATE);
    expect(screen.getByLabelText("Party size")).toHaveValue("4");

    // The same time is offered again and the typed details are still there.
    await user.click(screen.getByRole("radio", { name: /20:00/ }));
    expect(screen.getByLabelText("Name")).toHaveValue("Ana Perez");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Phone")).toHaveValue("+34 600 123 456");
    expect(screen.getByRole("button", CONFIRM)).toBeEnabled();
    expect(client.create.calls).toHaveLength(1);
  });

  it("announces the refreshed list in the polite region", async () => {
    await submitWith([refused({ code: "NO_AVAILABILITY", reason: "no_table_free" })]);
    await screen.findAllByRole("radio");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/times/i);
    });
  });

  it("an empty reloaded list shows the reason message", async () => {
    await submitWith(
      [refused({ code: "NO_AVAILABILITY", reason: "no_table_free" })],
      [timesOk(), timesEmpty("closed_day")],
    );
    expect(await findVisibleText(AVAILABILITY_MESSAGES.closed_day.title)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it.each([
    ["server error", { kind: "serverError" } as const, CLIENT_MESSAGES.timesServerError.title],
    ["unreachable", { kind: "unreachable" } as const, CLIENT_MESSAGES.timesUnreachable.title],
  ])(
    "a reload that fails with %s shows its state and keeps the details (FR-011)",
    async (_name, failure, title) => {
      const { user } = await submitWith(
        [refused({ code: "NO_AVAILABILITY", reason: "no_table_free" })],
        [timesOk(), failure, timesOk()],
      );
      expect(await findVisibleText(title)).toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));
      await user.click(await screen.findByRole("radio", { name: /20:00/ }));
      expect(screen.getByLabelText("Name")).toHaveValue("Ana Perez");
      expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
    },
  );

  it.each(OTHER_REASONS)("%s shows its own message, never the generic one", async (reason) => {
    await submitWith([refused({ code: "NO_AVAILABILITY", reason })]);
    const message = AVAILABILITY_MESSAGES[reason];
    expect(await findVisibleText(message.title)).toBeInTheDocument();
    expect(visibleText(message.body)).toHaveLength(1);
    expect(visibleText(GENERIC_MESSAGE.title)).toHaveLength(0);
    expect(visibleText(CLIENT_MESSAGES.noTableFreeLeadIn.title)).toHaveLength(0);
    noTechnicalText();
  });
});

describe("booking page - CONFLICT on confirm", () => {
  it("duplicate_reservation shows the duplicate message and nothing about the other reservation (FR-012)", async () => {
    await submitWith([refused({ code: "CONFLICT", reason: "duplicate_reservation" })]);
    const message = CONFLICT_MESSAGES.duplicate_reservation;
    const title = await findVisibleText(message.title);
    expect(visibleText(message.body)).toHaveLength(1);
    // The message itself carries no date, time, number or name.
    expect(title.closest(".status")?.textContent).not.toMatch(/\d/);
    expect(
      screen.queryByRole("heading", { level: 1, name: "Your table is booked" }),
    ).not.toBeInTheDocument();
    noTechnicalText();
  });

  it.each(["table_has_upcoming_reservations", "something_else"])(
    "%s shows the generic message",
    async (reason) => {
      await submitWith([refused({ code: "CONFLICT", reason })]);
      expect(await findVisibleText(GENERIC_MESSAGE.title)).toBeInTheDocument();
      expect(visibleText(CONFLICT_MESSAGES.duplicate_reservation.title)).toHaveLength(0);
      noTechnicalText();
    },
  );
});

describe("booking page - VALIDATION_ERROR on confirm", () => {
  it("shows each problem next to its field and keeps the values", async () => {
    await submitWith([
      refused({
        code: "VALIDATION_ERROR",
        fields: ["name", "email", "phone", "partySize", "date", "time"],
      }),
    ]);
    await screen.findByRole("region", { name: "There is a problem" });

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      `Error: ${FIELD_PROBLEMS.name}`,
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      `Error: ${FIELD_PROBLEMS.email}`,
    );
    expect(screen.getByLabelText("Phone")).toHaveAccessibleDescription(
      `Error: ${FIELD_PROBLEMS.phone}`,
    );
    expect(screen.getByLabelText("Party size")).toHaveAccessibleDescription(
      `Error: ${FIELD_PROBLEMS.partySize}`,
    );
    expect(screen.getByLabelText("Date")).toHaveAccessibleDescription(
      `Error: ${FIELD_PROBLEMS.date}`,
    );
    expect(screen.getByLabelText("Name")).toBeInvalid();
    expect(screen.getByRole("region", { name: "There is a problem" })).toHaveFocus();
    expect(visibleText(new RegExp(FIELD_PROBLEMS.time)).length).toBeGreaterThan(0);

    expect(screen.getByLabelText("Name")).toHaveValue("Ana Perez");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Date")).toHaveValue(DATE);
    expect(screen.getByRole("button", CONFIRM)).toBeEnabled();
  });

  it("an unknown field shows the form message and never the raw field name (FR-028)", async () => {
    await submitWith([refused({ code: "VALIDATION_ERROR", fields: ["form"] })]);
    expect(await findVisibleText(new RegExp(FIELD_PROBLEMS.form))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bform\b/i);
    noTechnicalText();
  });
});

describe("booking page - failures on confirm", () => {
  it("serverError says it was not completed, with a retry (FR-013)", async () => {
    const { client, user } = await submitWith([{ kind: "serverError" }, createOk()]);
    const message = CLIENT_MESSAGES.createServerError;
    expect(await findVisibleText(message.title)).toBeInTheDocument();
    expect(visibleText("Check your email before trying again.")).toHaveLength(1);
    expect(within(screen.getByRole("alert")).getByText(message.title)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Ana Perez");
    expect(screen.getByRole("button", CONFIRM)).toBeEnabled();
    noTechnicalText();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your table is booked" }),
    ).toBeInTheDocument();
    expect(client.create.calls).toHaveLength(2);
  });

  it("unreachable says the outcome is unknown, claiming neither success nor failure (FR-014)", async () => {
    await submitWith([{ kind: "unreachable" }]);
    const message = CLIENT_MESSAGES.createUnreachable;
    expect(await findVisibleText(message.title)).toBeInTheDocument();
    expect(visibleText(CLIENT_MESSAGES.createServerError.title)).toHaveLength(0);
    expect(
      screen.queryByRole("heading", { level: 1, name: "Your table is booked" }),
    ).not.toBeInTheDocument();
    expect(visibleText(/nothing was booked/i)).toHaveLength(0);
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
    expect(screen.getByRole("button", CONFIRM)).toBeEnabled();
    noTechnicalText();
  });

  it("retrying after an unknown outcome that was actually booked shows the duplicate message", async () => {
    const { client, user } = await submitWith([
      { kind: "unreachable" },
      refused({ code: "CONFLICT", reason: "duplicate_reservation" }),
    ]);
    await findVisibleText(CLIENT_MESSAGES.createUnreachable.title);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await findVisibleText(CONFLICT_MESSAGES.duplicate_reservation.title),
    ).toBeInTheDocument();
    expect(visibleText(CLIENT_MESSAGES.createUnreachable.title)).toHaveLength(0);
    expect(client.create.calls).toHaveLength(2);
    expect(
      screen.queryByRole("heading", { level: 1, name: "Your table is booked" }),
    ).not.toBeInTheDocument();
  });

  it.each(["SOMETHING_NEW", "NOT_FOUND", "INTERNAL_ERROR"])(
    "an unexpected code (%s) shows the generic message",
    async (code) => {
      await submitWith([refused({ code })]);
      expect(await findVisibleText(GENERIC_MESSAGE.title)).toBeInTheDocument();
      expect(
        within(screen.getByRole("alert")).getByText(GENERIC_MESSAGE.title),
      ).toBeInTheDocument();
      noTechnicalText();
    },
  );

  it("a refusal other than a taken time keeps the chosen time selected and the form usable", async () => {
    await submitWith([refused({ code: "CONFLICT", reason: "duplicate_reservation" })]);
    await findVisibleText(CONFLICT_MESSAGES.duplicate_reservation.title);
    expect(screen.getByRole("radio", { name: /20:00/ })).toBeChecked();
    expect(screen.getByRole("button", CONFIRM)).toBeEnabled();
  });
});
