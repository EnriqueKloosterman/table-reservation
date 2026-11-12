import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../../api/context";
import { CLIENT_MESSAGES, messageForCode, type Message } from "../../api/messages";
import type { BookingField, Confirmation } from "../../api/types";
import { useAnnounce } from "../../shared/a11y/LiveRegion";
import type { Problems } from "./DetailsForm";
import { validateDraft, type BookingDraft } from "./validators";

export type ReservationPhase = "editing" | "submitting" | "confirmed";

export interface ReservationApi {
  phase: ReservationPhase;
  /** Set only in the `confirmed` phase; holds nothing but what the customer may see. */
  confirmation: Confirmation | null;
  problems: Problems;
  problemsVersion: number;
  notice: Message | null;
  submit: () => Promise<void>;
  clearProblem: (field: BookingField) => void;
}

export function useReservation(draft: BookingDraft): ReservationApi {
  const client = useApiClient();
  const { assertive, polite } = useAnnounce();
  const [phase, setPhase] = useState<ReservationPhase>("editing");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [problemsVersion, setProblemsVersion] = useState(0);
  const [notice, setNotice] = useState<Message | null>(null);
  // Set synchronously before the request, so a second click or Enter in the same tick is ignored.
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const submit = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    try {
      const found = validateDraft(draft);
      const failed: Problems = {};
      for (const field of ["date", "partySize", "name", "email", "phone"] as const) {
        const problem = found[field];
        if (problem) failed[field] = problem;
      }
      if (draft.time === null || Object.keys(failed).length > 0) {
        setProblems(failed);
        setProblemsVersion((v) => v + 1);
        setNotice(null);
        assertive("Some details need fixing before you can book.");
        return;
      }

      setProblems({});
      setNotice(null);
      setPhase("submitting");
      const abort = new AbortController();
      controller.current = abort;
      const result = await client.createReservation(
        {
          date: draft.date,
          time: draft.time,
          partySize: Number(draft.partySize),
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;

      if (result.kind === "success") {
        setConfirmation(result.value);
        setPhase("confirmed");
        polite("Your table is booked.");
        return;
      }

      setPhase("editing");
      if (result.kind === "aborted") return;
      let message: Message;
      if (result.kind === "serverError") message = CLIENT_MESSAGES.createServerError;
      else if (result.kind === "unreachable") message = CLIENT_MESSAGES.createUnreachable;
      else message = messageForCode(result.refusal.code);
      setNotice(message);
      assertive(message.title);
    } finally {
      lock.current = false;
    }
  }, [client, draft, assertive, polite]);

  const clearProblem = useCallback((field: BookingField) => {
    setProblems((current) => {
      if (!current[field]) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([name]) => name !== field),
      );
    });
  }, []);

  return { phase, confirmation, problems, problemsVersion, notice, submit, clearProblem };
}
