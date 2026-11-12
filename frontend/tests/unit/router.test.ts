import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { navigate, usePathname } from "../../src/shared/router";

describe("router", () => {
  it("returns the current path", () => {
    history.replaceState(null, "", "/cancel");
    const { result } = renderHook(() => usePathname());
    expect(result.current).toBe("/cancel");
  });

  it("updates on popstate", () => {
    const { result } = renderHook(() => usePathname());
    expect(result.current).toBe("/");
    act(() => {
      history.pushState(null, "", "/cancel");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBe("/cancel");
  });

  it("navigate pushes a history entry and updates subscribers", () => {
    const { result } = renderHook(() => usePathname());
    const before = history.length;
    act(() => {
      navigate("/cancel");
    });
    expect(result.current).toBe("/cancel");
    expect(location.pathname).toBe("/cancel");
    expect(history.length).toBe(before + 1);
  });

  it("replaces an unknown path with / and renders as the booking destination", () => {
    history.replaceState(null, "", "/foo");
    const before = history.length;
    const { result } = renderHook(() => usePathname());
    expect(result.current).toBe("/");
    expect(location.pathname).toBe("/");
    expect(history.length).toBe(before);
  });
});
