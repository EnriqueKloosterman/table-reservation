import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../../api/context";
import { CLIENT_MESSAGES, ERROR_CODE_MESSAGES } from "../../api/messages";
import type { CancellationDone } from "../../api/types";
import { useAnnounce } from "../../shared/a11y/LiveRegion";
import { validateCode } from "../booking/validators";

export type CancelOutcome =
  | { kind: "cancelled"; value: CancellationDone }
  | { kind: "alreadyCancelled" }
  | { kind: "cannotCancel" }
  | { kind: "notFound" };

export interface CancellationApi {
  code: string;
  setCode: (value: string) => void;
  submitting: boolean;
  /** Set after a final answer; the code has been cleared. */
  outcome: CancelOutcome | null;
  /** The last attempt failed temporarily; the code is kept and trying again is safe. */
  failed: boolean;
  canSubmit: boolean;
  submit: () => Promise<void>;
}

function announcement(outcome: CancelOutcome): string {
  switch (outcome.kind) {
    case "cancelled":
      return CLIENT_MESSAGES.cancelled.title;
    case "alreadyCancelled":
      return ERROR_CODE_MESSAGES.ALREADY_CANCELLED.title;
    case "cannotCancel":
      return ERROR_CODE_MESSAGES.CANNOT_CANCEL.title;
    case "notFound":
      return ERROR_CODE_MESSAGES.NOT_FOUND.title;
  }
}

/** The code lives here only: never stored, never logged, cleared on every final outcome. */
export function useCancellation(initialCode: string | null): CancellationApi {
  const client = useApiClient();
  const { polite, assertive } = useAnnounce();
  const [code, setCode] = useState(initialCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<CancelOutcome | null>(null);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);

  // An answer that arrives after the page was left is dropped.
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const submit = useCallback(async () => {
    const trimmed = code.trim();
    if (lock.current || validateCode(trimmed) !== undefined) return;
    lock.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setSubmitting(true);
    setFailed(false);
    try {
      const result = await client.cancelReservation({ code: trimmed }, abort.signal);
      if (abort.signal.aborted || result.kind === "aborted") return;

      let final: CancelOutcome | null = null;
      if (result.kind === "success") {
        final = { kind: "cancelled", value: result.value };
      } else if (result.kind === "refusal") {
        switch (result.refusal.code) {
          case "ALREADY_CANCELLED":
            final = { kind: "alreadyCancelled" };
            break;
          case "CANNOT_CANCEL":
            final = { kind: "cannotCancel" };
            break;
          case "NOT_FOUND":
          case "VALIDATION_ERROR":
            final = { kind: "notFound" };
            break;
        }
      }

      if (final === null) {
        setFailed(true);
        assertive(CLIENT_MESSAGES.cancelTemporary.title);
        return;
      }
      setCode("");
      setOutcome(final);
      polite(announcement(final));
    } finally {
      lock.current = false;
      if (!abort.signal.aborted) setSubmitting(false);
    }
  }, [client, code, polite, assertive]);

  return {
    code,
    setCode,
    submitting,
    outcome,
    failed,
    canSubmit: validateCode(code) === undefined,
    submit,
  };
}
