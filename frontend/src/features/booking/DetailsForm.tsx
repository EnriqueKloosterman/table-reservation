import { useRef, type SyntheticEvent } from "react";
import { FIELD_PROBLEMS, type Message, type ProblemKey } from "../../api/messages";
import type { BookingField } from "../../api/types";
import { useFocusOnChange } from "../../shared/a11y/useFocusOnChange";
import { formatDate, formatTime } from "../../shared/dates";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { StatusMessage } from "../../shared/ui/StatusMessage";

export type DetailField = "name" | "email" | "phone";
export type Problems = Partial<Record<BookingField, ProblemKey>>;

const LABELS: Record<DetailField, string> = { name: "Name", email: "Email", phone: "Phone" };

interface DetailsFormProps {
  date: string;
  time: string;
  partySize: string;
  values: Record<DetailField, string>;
  problems: Problems;
  /** Changes each time validation fails, so the summary takes focus again. */
  problemsVersion: number;
  notice: Message | null;
  pending: boolean;
  onChange: (field: DetailField, value: string) => void;
  onSubmit: () => void;
}

export function DetailsForm({
  date,
  time,
  partySize,
  values,
  problems,
  problemsVersion,
  notice,
  pending,
  onChange,
  onSubmit,
}: DetailsFormProps) {
  const summaryRef = useRef<HTMLElement>(null);
  useFocusOnChange(summaryRef, problemsVersion);
  const listed = (Object.keys(LABELS) as DetailField[]).filter((field) => problems[field]);
  const problemText = (field: DetailField) => {
    const key = problems[field];
    return key ? FIELD_PROBLEMS[key] : undefined;
  };

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="details" noValidate onSubmit={handleSubmit} aria-labelledby="details-heading">
      <h2 id="details-heading">Your details</h2>
      <div role="group" aria-label="Your booking" className="summary">
        <p>
          <span className="summary__label">Date</span> <span>{formatDate(date)}</span>
        </p>
        <p>
          <span className="summary__label">Time</span> <span>{formatTime(time)}</span>
        </p>
        <p>
          <span className="summary__label">Party size</span> <span>{partySize}</span>
        </p>
      </div>

      {listed.length > 0 ? (
        <section
          ref={summaryRef}
          tabIndex={-1}
          aria-labelledby="problems-heading"
          className="status status--error"
        >
          <h2 id="problems-heading">There is a problem</h2>
          <ul>
            {listed.map((field) => (
              <li key={field}>
                {LABELS[field]}: {problemText(field)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notice ? <StatusMessage message={notice} variant="error" /> : null}

      <Field
        label="Name"
        autoComplete="name"
        value={values.name}
        disabled={pending}
        problem={problemText("name")}
        onChange={(event) => {
          onChange("name", event.currentTarget.value);
        }}
      />
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        value={values.email}
        disabled={pending}
        problem={problemText("email")}
        onChange={(event) => {
          onChange("email", event.currentTarget.value);
        }}
      />
      <Field
        label="Phone"
        type="tel"
        autoComplete="tel"
        value={values.phone}
        disabled={pending}
        problem={problemText("phone")}
        onChange={(event) => {
          onChange("phone", event.currentTarget.value);
        }}
      />
      <Button type="submit" busy={pending} busyLabel="Booking...">
        Confirm booking
      </Button>
    </form>
  );
}
