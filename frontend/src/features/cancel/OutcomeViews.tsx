import { useRef, type MouseEvent } from "react";
import { CLIENT_MESSAGES, ERROR_CODE_MESSAGES, type Message } from "../../api/messages";
import { useFocusOnChange } from "../../shared/a11y/useFocusOnChange";
import { formatDate, formatTime } from "../../shared/dates";
import { navigate } from "../../shared/router";
import type { CancelOutcome } from "./useCancellation";

function messageFor(outcome: CancelOutcome): Message {
  switch (outcome.kind) {
    case "cancelled":
      return CLIENT_MESSAGES.cancelled;
    case "alreadyCancelled":
      return ERROR_CODE_MESSAGES.ALREADY_CANCELLED;
    case "cannotCancel":
      return ERROR_CODE_MESSAGES.CANNOT_CANCEL;
    case "notFound":
      return ERROR_CODE_MESSAGES.NOT_FOUND;
  }
}

function goToBooking(event: MouseEvent<HTMLAnchorElement>) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  navigate("/");
}

/** One final outcome: its own h1 (focused), the catalog text and a way back to booking (FR-021). */
export function OutcomeView({ outcome }: { outcome: CancelOutcome }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(heading, outcome.kind, true);
  const message = messageFor(outcome);
  return (
    <section>
      <h1 ref={heading} tabIndex={-1}>
        {message.title}
      </h1>
      <p>{message.body}</p>
      {outcome.kind === "cancelled" ? (
        <ul aria-label="Reservation details" className="details-list">
          <li>
            <span className="summary__label">Date</span>{" "}
            <span>{formatDate(outcome.value.date)}</span>
          </li>
          <li>
            <span className="summary__label">Start time</span>{" "}
            <span>{formatTime(outcome.value.startTime)}</span>
          </li>
          <li>
            <span className="summary__label">End time</span>{" "}
            <span>{formatTime(outcome.value.endTime)}</span>
          </li>
          <li>
            <span className="summary__label">Party size</span>{" "}
            <span>{String(outcome.value.partySize)}</span>
          </li>
        </ul>
      ) : null}
      {outcome.kind !== "cancelled" && message.next ? <p>{message.next}</p> : null}
      <p>
        <a href="/" onClick={goToBooking}>
          Make a new booking
        </a>
      </p>
    </section>
  );
}
