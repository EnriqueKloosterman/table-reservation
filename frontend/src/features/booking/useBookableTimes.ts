import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../../api/context";
import { CLIENT_MESSAGES, FIELD_PROBLEMS } from "../../api/messages";
import type { BookableTimes } from "../../api/types";
import { useAnnounce } from "../../shared/a11y/LiveRegion";
import { validateDate, validatePartySize } from "./validators";

export type TimesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; periods: BookableTimes["periods"] }
  | { status: "empty"; reason: string | undefined }
  | { status: "refused" }
  | { status: "error" }
  | { status: "unreachable" };

type Settled = Exclude<TimesState, { status: "idle" } | { status: "loading" }>;

export interface BookableTimesApi {
  state: TimesState;
  /** Run the same query again (after an error). */
  retry: () => void;
  /** Reload the same query (after the chosen time was taken). */
  refresh: () => void;
}

/**
 * Bookable times for a date and a party size (both as typed). A request is sent only when both are
 * valid; only the answer of the latest request is ever applied (FR-003).
 */
export function useBookableTimes(date: string, partySize: string): BookableTimesApi {
  const client = useApiClient();
  const { polite, assertive } = useAnnounce();
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<{ key: string; result: Settled } | null>(null);
  const latest = useRef(0);

  const valid = validateDate(date) === undefined && validatePartySize(partySize) === undefined;
  const key = `${date}|${partySize}|${String(nonce)}`;

  useEffect(() => {
    if (!valid) return;
    latest.current += 1;
    const id = latest.current;
    const controller = new AbortController();
    void client
      .getTimes({ date, partySize: Number(partySize) }, controller.signal)
      .then((result) => {
        if (result.kind === "aborted" || controller.signal.aborted || id !== latest.current) return;
        let next: Settled;
        if (result.kind === "success") {
          const { reason } = result.value;
          // An empty service period is never shown (FR-002).
          const periods = result.value.periods.filter((period) => period.times.length > 0);
          next = periods.length > 0 ? { status: "ready", periods } : { status: "empty", reason };
        } else if (result.kind === "unreachable") {
          next = { status: "unreachable" };
        } else if (result.kind === "refusal" && result.refusal.code === "VALIDATION_ERROR") {
          next = { status: "refused" };
        } else {
          next = { status: "error" };
        }
        setSettled({ key, result: next });
        if (next.status === "ready") polite("Available times loaded.");
        else if (next.status === "empty") polite("No times are available for that choice.");
        else if (next.status === "unreachable") assertive(CLIENT_MESSAGES.timesUnreachable.title);
        else if (next.status === "refused") assertive(FIELD_PROBLEMS.form);
        else assertive(CLIENT_MESSAGES.timesServerError.title);
      });
    return () => {
      controller.abort();
    };
  }, [client, valid, date, partySize, key, polite, assertive]);

  const bump = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  let state: TimesState;
  if (!valid) state = { status: "idle" };
  else if (settled?.key === key) state = settled.result;
  else state = { status: "loading" };

  return { state, retry: bump, refresh: bump };
}
