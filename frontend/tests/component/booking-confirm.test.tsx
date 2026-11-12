import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client";
import { FakeApiClient } from "../support/fake-api-client";
import { renderApp } from "../support/render-app";
import { bookUpTo } from "../support/booking-helpers";
import { DATE_TEXT, createOk, timesOk } from "../support/fixtures";
import { deferred, type Deferred } from "../support/deferred";

afterEach(() => {
  vi.restoreAllMocks();
});

const SECRET = "SECRET-CODE-9f3a7c";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A real client over a stub `fetch` that answers with the wire shapes, secret code included. */
function wireClient() {
  const stub = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/availability/times")) {
      return Promise.resolve(
        jsonResponse(200, {
          date: "2026-11-14",
          partySize: 4,
          periods: [{ name: "Dinner", times: ["20:00"] }],
        }),
      );
    }
    return Promise.resolve(
      jsonResponse(201, {
        id: "res-1",
        secretCode: SECRET,
        date: "2026-11-14",
        startTime: "20:00",
        endTime: "21:30",
        partySize: 4,
        table: { id: "t1", name: "Table 7" },
        guest: { name: "Ana Perez", email: "ana@example.com", phone: "+34 600 123 456" },
        createdAt: "2026-11-12T10:00:00.000Z",
      }),
    );
  });
  return createApiClient({ baseUrl: "http://api.test", fetch: stub });
}

describe("booking page - confirmation", () => {
  it("shows the confirmation h1 (focused) and the booked details (FR-008)", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesOk()).script(client.create, createOk());
    renderApp({ client });
    const user = userEvent.setup();
    await bookUpTo(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "Your table is booked" });
    expect(heading).toHaveFocus();
    expect(screen.getByText(DATE_TEXT)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Booking details" });
    expect(within(list).getByText("20:00")).toBeInTheDocument();
    expect(within(list).getByText("21:30")).toBeInTheDocument();
    expect(within(list).getByText("4")).toBeInTheDocument();
    expect(within(list).getByText("Ana Perez")).toBeInTheDocument();
    expect(screen.getByText("We've emailed you how to cancel.")).toBeInTheDocument();
  });

  it("never exposes the secret code anywhere (FR-009)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    renderApp({ client: wireClient() });
    const user = userEvent.setup();
    await bookUpTo(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("heading", { level: 1, name: "Your table is booked" });

    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("secretCode");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    expect(window.location.href).not.toContain(SECRET);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("'Start a new booking' returns to an empty booking page (FR-015)", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesOk()).script(client.create, createOk());
    renderApp({ client });
    const user = userEvent.setup();
    await bookUpTo(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await user.click(await screen.findByRole("button", { name: "Start a new booking" }));

    expect(screen.getByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("");
    expect(screen.getByLabelText("Party size")).toHaveValue("");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(client.times.calls).toHaveLength(1);
  });

  it("double click and double Enter send exactly one request (FR-010, SC-004)", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.times, timesOk()).script(client.create, createOk());
    client.gate(client.create, gate);
    renderApp({ client });
    const user = userEvent.setup();
    await bookUpTo(user);
    const button = screen.getByRole("button", { name: "Confirm booking" });
    await user.dblClick(button);
    await user.type(screen.getByLabelText("Phone"), "{Enter}{Enter}");
    expect(client.create.calls).toHaveLength(1);
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    await screen.findByRole("heading", { level: 1, name: "Your table is booked" });
    expect(client.create.calls).toHaveLength(1);
  });

  it("two submits in the same tick still send exactly one request (the lock, not only the disabled button)", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.times, timesOk()).script(client.create, createOk());
    client.gate(client.create, gate);
    renderApp({ client });
    const user = userEvent.setup();
    await bookUpTo(user);
    const form = screen.getByRole("button", { name: "Confirm booking" }).closest("form");
    expect(form).not.toBeNull();
    act(() => {
      if (!form) return;
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(client.create.calls).toHaveLength(1);
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    await screen.findByRole("heading", { level: 1, name: "Your table is booked" });
    expect(client.create.calls).toHaveLength(1);
  });

  it("locks the form while the request is pending and releases it after a failure", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client
      .script(client.times, timesOk())
      .script(client.create, { kind: "serverError" }, createOk());
    client.gate(client.create, gate);
    renderApp({ client });
    const user = userEvent.setup();
    await bookUpTo(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    const busy = screen.getByRole("button", { name: "Booking..." });
    expect(busy).toBeDisabled();
    expect(screen.getByLabelText("Date")).toBeDisabled();
    expect(screen.getByLabelText("Party size")).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Phone")).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();

    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm booking" })).toBeEnabled();
    });
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByLabelText("Name")).toHaveValue("Ana Perez");
  });

  it("does not resubmit on history Back and starts fresh after a reload", async () => {
    const client = new FakeApiClient();
    client.script(client.times, timesOk()).script(client.create, createOk());
    const view = renderApp({ client });
    const user = userEvent.setup();
    await bookUpTo(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await screen.findByRole("heading", { level: 1, name: "Your table is booked" });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(client.create.calls).toHaveLength(1);

    view.unmount();
    const fresh = new FakeApiClient();
    fresh.script(fresh.times, timesOk());
    renderApp({ client: fresh });
    expect(screen.getByLabelText("Date")).toHaveValue("");
    expect(screen.getByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
    expect(fresh.create.calls).toHaveLength(0);
  });
});
