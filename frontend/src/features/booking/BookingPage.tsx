import { useCallback, useState } from "react";
import {
  AVAILABILITY_MESSAGES,
  CLIENT_MESSAGES,
  FIELD_PROBLEMS,
  GENERIC_MESSAGE,
  messageForAvailability,
  type Message,
} from "../../api/messages";
import { useDocumentTitle } from "../../shared/useDocumentTitle";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { Confirmation } from "./Confirmation";
import { DateAndParty } from "./DateAndParty";
import { DetailsForm, type DetailField } from "./DetailsForm";
import { TimeChoices } from "./TimeChoices";
import { useBookableTimes, type TimesState } from "./useBookableTimes";
import { useReservation } from "./useReservation";
import type { BookingDraft } from "./validators";

const EMPTY_DRAFT: BookingDraft = { date: "", partySize: "", time: null, name: "", email: "", phone: "" };

/** Everything typed lives in this component's state only; "Start a new booking" remounts it empty. */
export function BookingPage() {
  const [run, setRun] = useState(0);
  return (
    <BookingFlow
      key={run}
      onNewBooking={() => {
        setRun((n) => n + 1);
      }}
    />
  );
}

function BookingFlow({ onNewBooking }: { onNewBooking: () => void }) {
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const times = useBookableTimes(draft.date, draft.partySize);
  const { refresh } = times;
  const reservation = useReservation(draft, {
    onTimeTaken: useCallback(() => {
      // Only the chosen time goes; date, party size and the typed details stay.
      setDraft((current) => ({ ...current, time: null }));
      refresh();
    }, [refresh]),
  });

  const confirmed = reservation.phase === "confirmed" && reservation.confirmation !== null;
  useDocumentTitle(confirmed ? CLIENT_MESSAGES.confirmation.title : "Book a table");

  if (reservation.phase === "confirmed" && reservation.confirmation) {
    return <Confirmation confirmation={reservation.confirmation} onNewBooking={onNewBooking} />;
  }

  const pending = reservation.phase === "submitting";
  const { state } = times;

  function change(patch: Partial<BookingDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  /** A new date, party size or time makes the last refusal and server problems out of date. */
  function changeChoice(patch: Partial<BookingDraft>, field: "date" | "partySize" | "time") {
    change(patch);
    reservation.clearNotice();
    reservation.clearProblem(field);
    reservation.clearProblem("time");
  }

  return (
    <section>
      <h1>Book a table</h1>
      <DateAndParty
        date={draft.date}
        partySize={draft.partySize}
        disabled={pending}
        serverProblems={{ date: reservation.problems.date, partySize: reservation.problems.partySize }}
        onDateChange={(value) => {
          changeChoice({ date: value, time: null }, "date");
        }}
        onPartySizeChange={(value) => {
          changeChoice({ partySize: value, time: null }, "partySize");
        }}
      />

      {reservation.notice ? (
        <StatusMessage message={reservation.notice.message} variant="error">
          {reservation.notice.retry ? (
            <Button
              disabled={pending}
              onClick={() => {
                void reservation.submit();
              }}
            >
              Try again
            </Button>
          ) : null}
        </StatusMessage>
      ) : null}

      <div className="times-region">
        <TimesRegion
          state={state}
          selected={draft.time}
          disabled={pending}
          onSelect={(time) => {
            changeChoice({ time }, "time");
          }}
          onRetry={times.retry}
        />
      </div>

      {draft.time !== null && state.status === "ready" ? (
        <DetailsForm
          date={draft.date}
          time={draft.time}
          partySize={draft.partySize}
          values={{ name: draft.name, email: draft.email, phone: draft.phone }}
          problems={reservation.problems}
          problemsVersion={reservation.problemsVersion}
          pending={pending}
          onChange={(field: DetailField, value: string) => {
            change({ [field]: value });
            reservation.clearProblem(field);
          }}
          onSubmit={() => {
            void reservation.submit();
          }}
        />
      ) : null}
    </section>
  );
}

interface TimesRegionProps {
  state: TimesState;
  selected: string | null;
  disabled: boolean;
  onSelect: (time: string) => void;
  onRetry: () => void;
}

function TimesRegion({ state, selected, disabled, onSelect, onRetry }: TimesRegionProps) {
  switch (state.status) {
    case "idle":
      return <StatusMessage message={CLIENT_MESSAGES.idlePrompt} />;
    case "loading":
      return (
        <p>
          <Spinner />
          Loading the available times...
        </p>
      );
    case "ready":
      return (
        <TimeChoices
          periods={state.periods}
          selected={selected}
          disabled={disabled}
          onSelect={onSelect}
        />
      );
    case "empty": {
      const known = state.reason !== undefined && Object.hasOwn(AVAILABILITY_MESSAGES, state.reason);
      const message: Message =
        state.reason !== undefined && known ? messageForAvailability(state.reason) : GENERIC_MESSAGE;
      return (
        <StatusMessage message={message}>
          {known ? null : <Button onClick={onRetry}>Try again</Button>}
        </StatusMessage>
      );
    }
    case "refused": {
      return (
        <StatusMessage message={{ title: FIELD_PROBLEMS.form, body: "" }} variant="error">
          <Button onClick={onRetry}>Try again</Button>
        </StatusMessage>
      );
    }
    case "error":
      return (
        <StatusMessage message={CLIENT_MESSAGES.timesServerError} variant="error">
          <Button onClick={onRetry}>Try again</Button>
        </StatusMessage>
      );
    case "unreachable":
      return (
        <StatusMessage message={CLIENT_MESSAGES.timesUnreachable} variant="error">
          <Button onClick={onRetry}>Try again</Button>
        </StatusMessage>
      );
  }
}
