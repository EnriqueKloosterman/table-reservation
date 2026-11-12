import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "../../api/context";
import {
  CLIENT_MESSAGES,
  GENERIC_MESSAGE,
  messageForAvailability,
  messageForConflict,
  type Message,
} from "../../api/messages";
import type { Confirmation, FieldProblem } from "../../api/types";
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
  notice: Notice | null;
  submit: () => Promise<void>;
  clearProblem: (field: FieldProblem) => void;
  clearNotice: () => void;
}

/** A refusal or failure shown above the form; `retry` offers the same submission again. */
export interface Notice {
  message: Message;
  retry: boolean;
}

interface ReservationOptions {
  /** The chosen time was just taken: clear it and reload the list for the same date and party. */
  onTimeTaken: () => void;
}

export function useReservation(draft: BookingDraft, { onTimeTaken }: ReservationOptions): ReservationApi {
  const client = useApiClient();
  const { assertive, polite } = useAnnounce();
  const [phase, setPhase] = useState<ReservationPhase>("editing");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [problemsVersion, setProblemsVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
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

      let shown: Notice;
      if (result.kind === "serverError") {
        shown = { message: CLIENT_MESSAGES.createServerError, retry: true };
      } else if (result.kind === "unreachable") {
        shown = { message: CLIENT_MESSAGES.createUnreachable, retry: true };
      } else if (result.refusal.code === "VALIDATION_ERROR") {
        const fields = "fields" in result.refusal ? result.refusal.fields : [];
        const found: Problems = {};
        for (const field of fields) found[field] = field;
        if (Object.keys(found).length === 0) found.form = "form";
        setProblems(found);
        setProblemsVersion((v) => v + 1);
        assertive("Some details need fixing before you can book.");
        return;
      } else if (result.refusal.code === "NO_AVAILABILITY" && "reason" in result.refusal) {
        const { reason } = result.refusal;
        if (reason === "no_table_free") {
          shown = { message: CLIENT_MESSAGES.noTableFreeLeadIn, retry: false };
        } else {
          shown = { message: messageForAvailability(reason), retry: false };
        }
        setNotice(shown);
        assertive(shown.message.title);
        onTimeTaken();
        return;
      } else if (result.refusal.code === "CONFLICT" && "reason" in result.refusal) {
        shown = { message: messageForConflict(result.refusal.reason), retry: false };
      } else {
        shown = { message: GENERIC_MESSAGE, retry: false };
      }
      setNotice(shown);
      assertive(shown.message.title);
    } finally {
      lock.current = false;
    }
  }, [client, draft, assertive, polite, onTimeTaken]);

  const clearProblem = useCallback((field: FieldProblem) => {
    setProblems((current) => {
      if (!current[field]) return current;
      return Object.fromEntries(Object.entries(current).filter(([name]) => name !== field));
    });
  }, []);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return { phase, confirmation, problems, problemsVersion, notice, submit, clearProblem, clearNotice };
}
