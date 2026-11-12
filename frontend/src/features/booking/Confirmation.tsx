import { useRef } from "react";
import { CLIENT_MESSAGES } from "../../api/messages";
import type { Confirmation as ConfirmationData } from "../../api/types";
import { useFocusOnChange } from "../../shared/a11y/useFocusOnChange";
import { formatDate, formatTime } from "../../shared/dates";
import { Button } from "../../shared/ui/Button";

interface ConfirmationProps {
  confirmation: ConfirmationData;
  onNewBooking: () => void;
}

export function Confirmation({ confirmation, onNewBooking }: ConfirmationProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnChange(heading, true, true);
  return (
    <section>
      <h1 ref={heading} tabIndex={-1}>
        {CLIENT_MESSAGES.confirmation.title}
      </h1>
      <p>{CLIENT_MESSAGES.confirmation.body}</p>
      <ul aria-label="Booking details" className="details-list">
        <li>
          <span className="summary__label">Date</span> <span>{formatDate(confirmation.date)}</span>
        </li>
        <li>
          <span className="summary__label">Start time</span>{" "}
          <span>{formatTime(confirmation.startTime)}</span>
        </li>
        <li>
          <span className="summary__label">End time</span>{" "}
          <span>{formatTime(confirmation.endTime)}</span>
        </li>
        <li>
          <span className="summary__label">Party size</span>{" "}
          <span>{String(confirmation.partySize)}</span>
        </li>
        <li>
          <span className="summary__label">Name</span> <span>{confirmation.guestName}</span>
        </li>
      </ul>
      <Button onClick={onNewBooking}>Start a new booking</Button>
    </section>
  );
}
