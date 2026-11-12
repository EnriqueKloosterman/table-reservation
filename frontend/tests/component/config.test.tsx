import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../src/bootstrap";

const roots: { unmount: () => void }[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function start(url: string, rawApiBaseUrl: string | undefined) {
  history.replaceState(null, "", url);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = bootstrap(container, { rawApiBaseUrl }) as unknown as { unmount: () => void };
  roots.push(root);
}

const TECHNICAL = /VITE|URL|\benv\b|http|localhost|configur/i;

describe("service not available (FR-030)", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["invalid", "not a url"],
    ["with a path", "http://api.test/v1"],
  ])("shows the screen when the server address is %s, with no request", async (_name, raw) => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    start("/", raw);

    const heading = await screen.findByRole("heading", { level: 1, name: "Service not available" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("This service isn't available right now.")).toBeInTheDocument();
    expect(screen.getByText("Please try again later.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Book a table" })).not.toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(document.title).toBe("Service not available - Table reservation");

    expect(document.body.textContent).not.toMatch(TECHNICAL);
  });

  it("shows the booking page with a valid address", async () => {
    vi.stubGlobal("fetch", vi.fn());
    start("/", "http://api.test");
    expect(await screen.findByRole("heading", { level: 1, name: "Book a table" })).toBeInTheDocument();
    expect(screen.queryByText("Service not available")).not.toBeInTheDocument();
  });

  it("on the cancellation path still strips the fragment and makes no request", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    start("/cancel#code=SECRET123", undefined);

    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("SECRET123");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Service not available" }),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("SECRET123");
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
