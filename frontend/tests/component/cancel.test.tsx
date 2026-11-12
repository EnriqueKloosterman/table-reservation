import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/api/client";
import { CLIENT_MESSAGES, ERROR_CODE_MESSAGES } from "../../src/api/messages";
import { navigate } from "../../src/shared/router";
import { findVisibleText, visibleText } from "../support/booking-helpers";
import { deferred, type Deferred } from "../support/deferred";
import { FakeApiClient, type CancelResult } from "../support/fake-api-client";
import { DATE_TEXT, cancelOk, cancelRefused } from "../support/fixtures";
import { renderApp } from "../support/render-app";

const CODE = "SECRET-CANCEL-77x";
const CANCEL_BUTTON = { name: "Cancel my reservation" } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(results: CancelResult[], initialCancelCode: string | null = CODE) {
  const client = new FakeApiClient();
  client.script(client.cancel, ...results);
  const view = renderApp({ client, path: "/cancel", initialCancelCode });
  return { client, view, user: userEvent.setup() };
}

async function press(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", CANCEL_BUTTON));
}

describe("cancellation page - with a code from the link", () => {
  it("sends nothing on load and shows an explicit button (FR-017, SC-005)", () => {
    const { client } = setup([cancelOk()]);
    expect(
      screen.getByRole("heading", { level: 1, name: "Cancel your reservation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", CANCEL_BUTTON)).toBeEnabled();
    expect(screen.queryByLabelText("Cancellation code")).not.toBeInTheDocument();
    expect(client.cancel.calls).toHaveLength(0);
  });

  it("sends exactly one request with the code in the body when the button is pressed", async () => {
    const { client, user } = setup([cancelOk()]);
    await press(user);
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
    expect(client.cancel.calls).toEqual([{ code: CODE }]);
  });

  it("cancelled: shows the cancelled reservation, focuses the h1 and announces it", async () => {
    const { user } = setup([cancelOk()]);
    await press(user);
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: CLIENT_MESSAGES.cancelled.title,
    });
    expect(heading).toHaveFocus();
    const list = screen.getByRole("list", { name: "Reservation details" });
    expect(within(list).getByText(DATE_TEXT)).toBeInTheDocument();
    expect(within(list).getByText("20:00")).toBeInTheDocument();
    expect(within(list).getByText("21:30")).toBeInTheDocument();
    expect(within(list).getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });

  it.each([
    ["ALREADY_CANCELLED", ERROR_CODE_MESSAGES.ALREADY_CANCELLED],
    ["CANNOT_CANCEL", ERROR_CODE_MESSAGES.CANNOT_CANCEL],
    ["NOT_FOUND", ERROR_CODE_MESSAGES.NOT_FOUND],
    ["VALIDATION_ERROR", ERROR_CODE_MESSAGES.NOT_FOUND],
  ])("%s shows its own final outcome", async (code, message) => {
    const { user } = setup([cancelRefused(code)]);
    await press(user);
    const heading = await screen.findByRole("heading", { level: 1, name: message.title });
    expect(heading).toHaveFocus();
    expect(visibleText(message.body)).toHaveLength(1);
    if (message.next) expect(visibleText(message.next)).toHaveLength(1);
    expect(screen.queryByRole("button", CANCEL_BUTTON)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Reservation details" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b\d{3}\b|_/);
  });

  it("the four outcomes are told apart", () => {
    const titles = [
      CLIENT_MESSAGES.cancelled.title,
      ERROR_CODE_MESSAGES.ALREADY_CANCELLED.title,
      ERROR_CODE_MESSAGES.CANNOT_CANCEL.title,
      ERROR_CODE_MESSAGES.NOT_FOUND.title,
    ];
    expect(new Set(titles).size).toBe(4);
    expect(ERROR_CODE_MESSAGES.CANNOT_CANCEL.body).toMatch(/started or ended/);
  });

  it("every outcome links back to the booking page (FR-021)", async () => {
    const { user } = setup([cancelRefused("NOT_FOUND")]);
    await press(user);
    await screen.findByRole("heading", { level: 1, name: ERROR_CODE_MESSAGES.NOT_FOUND.title });
    await user.click(screen.getByRole("link", { name: "Make a new booking" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Book a table" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("double click and double Enter send exactly one request (SC-004)", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.cancel, cancelOk());
    client.gate(client.cancel, gate);
    renderApp({ client, path: "/cancel", initialCancelCode: CODE });
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole("button", CANCEL_BUTTON));
    screen.getByRole("button", { name: /Cancelling/ }).focus();
    await user.keyboard("{Enter}{Enter}");
    expect(client.cancel.calls).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Cancelling/ })).toBeDisabled();

    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
    expect(client.cancel.calls).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("never exposes the code in the page, storage, address or console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { user } = setup([cancelOk()]);
    const check = () => {
      expect(document.body.innerHTML).not.toContain(CODE);
      expect(document.body.textContent).not.toContain(CODE);
      expect(window.localStorage.length).toBe(0);
      expect(window.sessionStorage.length).toBe(0);
      expect(document.cookie).toBe("");
      expect(window.location.href).not.toContain(CODE);
    };
    check();
    await press(user);
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
    check();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("cancellation page - temporary failures", () => {
  it("shows a retryable message, keeps the code, and a retry succeeds", async () => {
    const { client, user } = setup([
      { kind: "serverError" },
      { kind: "unreachable" },
      cancelOk(),
    ]);
    await press(user);
    await findVisibleText(CLIENT_MESSAGES.cancelTemporary.title);
    expect(
      within(screen.getByRole("alert")).getByText(CLIENT_MESSAGES.cancelTemporary.title),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Cancel your reservation" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(client.cancel.calls).toHaveLength(2);
    });
    await findVisibleText(CLIENT_MESSAGES.cancelTemporary.title);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
    expect(client.cancel.calls).toEqual([{ code: CODE }, { code: CODE }, { code: CODE }]);
  });

  it("an unexpected error code is a temporary failure with the generic retry message", async () => {
    const { user } = setup([cancelRefused("SOMETHING_NEW"), cancelOk()]);
    await press(user);
    await findVisibleText(CLIENT_MESSAGES.cancelTemporary.title);
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/SOMETHING_NEW/);
  });

  it("a malformed answer is a temporary failure with a retry", async () => {
    const stub = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetch: stub });
    renderApp({ client, path: "/cancel", initialCancelCode: CODE });
    const user = userEvent.setup();
    await press(user);
    await findVisibleText(CLIENT_MESSAGES.cancelTemporary.title);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("cancellation page - without a code", () => {
  it("explains the missing code, shows a labelled field and a disabled button while empty", () => {
    const { client } = setup([cancelOk()], null);
    expect(
      screen.getByRole("heading", { level: 1, name: "Cancel your reservation" }),
    ).toBeInTheDocument();
    expect(visibleText(/couldn't find a cancellation code/i)).toHaveLength(1);
    expect(screen.getByLabelText("Cancellation code")).toHaveValue("");
    expect(screen.getByRole("button", CANCEL_BUTTON)).toBeDisabled();
    expect(client.cancel.calls).toHaveLength(0);
  });

  it("trims pasted spaces and uses the same explicit button", async () => {
    const { client, user } = setup([cancelOk()], null);
    await user.type(screen.getByLabelText("Cancellation code"), "   abc-123   ");
    expect(screen.getByRole("button", CANCEL_BUTTON)).toBeEnabled();
    expect(client.cancel.calls).toHaveLength(0);
    await press(user);
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
    expect(client.cancel.calls).toEqual([{ code: "abc-123" }]);
  });

  it("a code made only of spaces keeps the button disabled", async () => {
    const { user } = setup([cancelOk()], null);
    await user.type(screen.getByLabelText("Cancellation code"), "    ");
    expect(screen.getByRole("button", CANCEL_BUTTON)).toBeDisabled();
  });

  it("a fresh render without the code (a reload) behaves as having no code", () => {
    const { view } = setup([cancelOk()]);
    view.unmount();
    const fresh = new FakeApiClient();
    fresh.script(fresh.cancel, cancelOk());
    renderApp({ client: fresh, path: "/cancel" });
    expect(screen.getByLabelText("Cancellation code")).toHaveValue("");
    expect(screen.getByRole("button", CANCEL_BUTTON)).toBeDisabled();
    expect(fresh.cancel.calls).toHaveLength(0);
  });

  it("a fresh render of the same link in a new session shows 'already cancelled'", async () => {
    const { user } = setup([cancelRefused("ALREADY_CANCELLED")], CODE);
    await press(user);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: ERROR_CODE_MESSAGES.ALREADY_CANCELLED.title,
      }),
    ).toBeInTheDocument();
  });
});

describe("cancellation page - the code is used once (FR-020)", () => {
  it("after a final outcome the code is gone: coming back shows an empty manual field", async () => {
    const { client, user } = setup([cancelOk()]);
    await press(user);
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });

    await user.click(screen.getByRole("link", { name: "Make a new booking" }));
    await screen.findByRole("heading", { level: 1, name: "Book a table" });
    act(() => {
      navigate("/cancel");
    });

    expect(await screen.findByLabelText("Cancellation code")).toHaveValue("");
    expect(screen.getByRole("button", CANCEL_BUTTON)).toBeDisabled();
    expect(client.cancel.calls).toHaveLength(1);
  });

  it("navigating away before pressing and back never restores the code", async () => {
    const { client } = setup([cancelOk()]);
    act(() => {
      navigate("/");
    });
    await screen.findByRole("heading", { level: 1, name: "Book a table" });
    act(() => {
      navigate("/cancel");
    });
    expect(await screen.findByLabelText("Cancellation code")).toHaveValue("");
    expect(client.cancel.calls).toHaveLength(0);
  });

  it("history Back (popstate) from an outcome or the manual state sends no request", async () => {
    const { client, user } = setup([cancelOk()]);
    await press(user);
    await screen.findByRole("heading", { level: 1, name: CLIENT_MESSAGES.cancelled.title });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(client.cancel.calls).toHaveLength(1);
    expect(screen.queryByLabelText("Cancellation code")).not.toBeInTheDocument();
  });

  it("an answer that arrives after the visitor moved to the booking page is ignored", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.cancel, cancelOk());
    client.gate(client.cancel, gate);
    renderApp({ client, path: "/cancel", initialCancelCode: CODE });
    const user = userEvent.setup();
    await press(user);

    act(() => {
      navigate("/");
    });
    await screen.findByRole("heading", { level: 1, name: "Book a table" });
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
    expect(visibleText(CLIENT_MESSAGES.cancelled.title)).toHaveLength(0);
    expect(screen.getByRole("status")).not.toHaveTextContent(/cancelled/i);
  });
});
