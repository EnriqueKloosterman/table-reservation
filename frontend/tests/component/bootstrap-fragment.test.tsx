import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../src/bootstrap";

const SECRET = "SECRET123";
const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A `fetch` that records every call, and the address bar at the time of the call. */
function stubFetch() {
  const seen: { url: string; body: string; hashAtCall: string }[] = [];
  const stub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      hashAtCall: window.location.hash,
    });
    return Promise.resolve(
      jsonResponse(409, { error: { code: "ALREADY_CANCELLED", message: "x" } }),
    );
  });
  vi.stubGlobal("fetch", stub);
  return { stub, seen };
}

function start(url: string) {
  history.replaceState(null, "", url);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = bootstrap(container, { rawApiBaseUrl: "http://api.test" }) as unknown as {
    unmount: () => void;
  };
  roots.push(root);
  return root;
}

describe("bootstrap - cancellation fragment (FR-016, FR-017)", () => {
  it("removes the fragment before the first render and before any request", () => {
    const { stub } = stubFetch();
    const before = history.length;
    start(`/cancel#code=${SECRET}`);

    // Synchronously after bootstrap(): nothing rendered yet is needed to prove this.
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(SECRET);
    expect(window.location.pathname).toBe("/cancel");
    expect(history.length).toBe(before);
    expect(history.state).toBeNull();
    expect(stub).not.toHaveBeenCalled();
  });

  it("keeps the query string", () => {
    stubFetch();
    start(`/cancel?lang=en#code=${SECRET}`);
    expect(window.location.search).toBe("?lang=en");
    expect(window.location.hash).toBe("");
  });

  it("hands the code to the cancellation page, which sends nothing until the button is pressed", async () => {
    const { stub, seen } = stubFetch();
    start(`/cancel#code=${SECRET}`);
    const user = userEvent.setup();

    const button = await screen.findByRole("button", { name: "Cancel my reservation" });
    expect(stub).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(SECRET);

    await user.click(button);
    await screen.findByRole("heading", { level: 1, name: "This reservation was already cancelled." });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ code: SECRET });
    expect(seen[0]?.url).not.toContain(SECRET);
    expect(seen[0]?.hashAtCall).toBe("");
  });

  it.each([
    ["no fragment", "/cancel"],
    ["a fragment without code=", "/cancel#other=1"],
    ["an empty code", "/cancel#code="],
    ["a blank code", "/cancel#code=%20%20"],
  ])("passes no code for %s (manual entry is shown)", async (_name, url) => {
    stubFetch();
    start(url);
    expect(await screen.findByLabelText("Cancellation code")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Cancel my reservation" })).toBeDisabled();
    expect(window.location.hash).toBe("");
  });

  it("does not look at the fragment on the booking page", async () => {
    const { stub } = stubFetch();
    start("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
    expect(stub).not.toHaveBeenCalled();
  });
});

describe("index.html", () => {
  it("tells browsers never to send a referrer", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
  });
});
