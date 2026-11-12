import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClientProvider } from "../../src/api/context";
import { LiveRegionProvider } from "../../src/shared/a11y/LiveRegion";
import { useBookableTimes } from "../../src/features/booking/useBookableTimes";
import { FakeApiClient } from "../support/fake-api-client";
import { deferred, type Deferred } from "../support/deferred";
import { timesOk } from "../support/fixtures";

function wrapperFor(client: FakeApiClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ApiClientProvider, {
      client,
      children: createElement(LiveRegionProvider, { children }),
    });
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("useBookableTimes - the latest request wins (FR-003)", () => {
  it("keeps B's answer when B resolves first and A last, and aborts A's signal", async () => {
    const client = new FakeApiClient();
    const gateA: Deferred<void> = deferred();
    const gateB: Deferred<void> = deferred();
    client.script(
      client.times,
      timesOk([{ name: "A-period", times: ["12:00"] }]),
      timesOk([{ name: "B-period", times: ["21:00"] }]),
    );
    client.gate(client.times, gateA).gate(client.times, gateB);
    const signals: (AbortSignal | undefined)[] = [];
    const original = client.getTimes.bind(client);
    client.getTimes = (query, signal) => {
      signals.push(signal);
      return original(query, signal);
    };

    const { result, rerender } = renderHook(({ date, party }) => useBookableTimes(date, party), {
      wrapper: wrapperFor(client),
      initialProps: { date: "2026-11-14", party: "4" },
    });
    rerender({ date: "2026-11-14", party: "2" });
    await flush();
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      gateB.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      gateA.resolve();
      await Promise.resolve();
    });
    const state = result.current.state;
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.periods[0]?.name).toBe("B-period");
  });

  it("ignores a late answer even when the client does not honour the abort signal", async () => {
    const client = new FakeApiClient();
    const gateA: Deferred<ReturnType<typeof timesOk>> = deferred();
    const gateB: Deferred<ReturnType<typeof timesOk>> = deferred();
    const gates = [gateA, gateB];
    let call = 0;
    client.getTimes = () => {
      const gate = gates[call];
      call += 1;
      if (!gate) throw new Error("unexpected call");
      return gate.promise;
    };
    const { result, rerender } = renderHook(({ party }) => useBookableTimes("2026-11-14", party), {
      wrapper: wrapperFor(client),
      initialProps: { party: "4" },
    });
    rerender({ party: "2" });
    await act(async () => {
      gateB.resolve(timesOk([{ name: "B-period", times: ["21:00"] }]));
      await Promise.resolve();
    });
    await act(async () => {
      gateA.resolve(timesOk([{ name: "A-period", times: ["12:00"] }]));
      await Promise.resolve();
    });
    const state = result.current.state;
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.periods[0]?.name).toBe("B-period");
  });

  it("an aborted result never sets state", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.times, timesOk());
    client.gate(client.times, gate);
    const { result, rerender } = renderHook(({ party }) => useBookableTimes("2026-11-14", party), {
      wrapper: wrapperFor(client),
      initialProps: { party: "4" },
    });
    expect(result.current.state.status).toBe("loading");
    rerender({ party: "" });
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("idle");
  });

  it("returns to idle and discards a pending answer when an input becomes invalid", async () => {
    const client = new FakeApiClient();
    const gate: Deferred<void> = deferred();
    client.script(client.times, timesOk());
    client.gate(client.times, gate);
    const { result, rerender } = renderHook(({ party }) => useBookableTimes("2026-11-14", party), {
      wrapper: wrapperFor(client),
      initialProps: { party: "4" },
    });
    expect(result.current.state.status).toBe("loading");
    rerender({ party: "0" });
    expect(result.current.state.status).toBe("idle");
    await act(async () => {
      gate.resolve();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("idle");
  });
});
