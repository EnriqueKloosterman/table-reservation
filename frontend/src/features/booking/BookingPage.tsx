import { useState } from "react";
import {
  CLIENT_MESSAGES,
  GENERIC_MESSAGE,
  messageForAvailability,
  type Message,
} from "../../api/messages";
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
  const reservation = useReservation(draft);

  if (reservation.phase === "confirmed" && reservation.confirmation) {
    return <Confirmation confirmation={reservation.confirmation} onNewBooking={onNewBooking} />;
  }

  const pending = reservation.phase === "submitting";
  const { state } = times;

  function change(patch: Partial<BookingDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <section>
      <h1>Book a table</h1>
      <DateAndParty
        date={draft.date}
        partySize={draft.partySize}
        disabled={pending}
        onDateChange={(value) => {
          change({ date: value, time: null });
        }}
        onPartySizeChange={(value) => {
          change({ partySize: value, time: null });
        }}
      />

      <div className="times-region">
        <TimesRegion
          state={state}
          selected={draft.time}
          disabled={pending}
          onSelect={(time) => {
            change({ time });
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
          notice={reservation.notice}
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
      const message: Message =
        state.reason === undefined ? GENERIC_MESSAGE : messageForAvailability(state.reason);
      return (
        <StatusMessage message={message}>
          {state.reason === undefined ? <Button onClick={onRetry}>Try again</Button> : null}
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
