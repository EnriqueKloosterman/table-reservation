import { useRef, type SyntheticEvent } from "react";
import { FIELD_PROBLEMS, type ProblemKey } from "../../api/messages";
import type { FieldProblem } from "../../api/types";
import { useFocusOnChange } from "../../shared/a11y/useFocusOnChange";
import { formatDate, formatTime } from "../../shared/dates";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";

export type DetailField = "name" | "email" | "phone";
export type Problems = Partial<Record<FieldProblem, ProblemKey>>;

/** Order and labels of the error summary; "form" has no field, so it is listed without a label. */
const SUMMARY: [FieldProblem, string | null][] = [
  ["date", "Date"],
  ["partySize", "Party size"],
  ["time", "Time"],
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["form", null],
];

interface DetailsFormProps {
  date: string;
  time: string;
  partySize: string;
  values: Record<DetailField, string>;
  problems: Problems;
  /** Changes each time validation fails, so the summary takes focus again. */
  problemsVersion: number;
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
  pending,
  onChange,
  onSubmit,
}: DetailsFormProps) {
  const summaryRef = useRef<HTMLElement>(null);
  useFocusOnChange(summaryRef, problemsVersion);
  const listed = SUMMARY.filter(([field]) => problems[field]);
  const problemText = (field: FieldProblem) => {
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
            {listed.map(([field, label]) => (
              <li key={field}>
                {label ? `${label}: ` : ""}
                {problemText(field)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
