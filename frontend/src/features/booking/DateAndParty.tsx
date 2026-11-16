import { useState } from "react";
import { FIELD_PROBLEMS, type ProblemKey } from "../../api/messages";
import { Field } from "../../shared/ui/Field";
import { validatePartySize } from "./validators";

interface DateAndPartyProps {
  date: string;
  partySize: string;
  disabled: boolean;
  /** Problems the server reported for these two fields. */
  serverProblems?: { date?: ProblemKey; partySize?: ProblemKey };
  onDateChange: (value: string) => void;
  onPartySizeChange: (value: string) => void;
}

/** No min/max on the date: the server's answers are the only authority on which days can be booked. */
export function DateAndParty({
  date,
  partySize,
  disabled,
  serverProblems,
  onDateChange,
  onPartySizeChange,
}: DateAndPartyProps) {
  const [dateIsBad, setDateIsBad] = useState(false);
  const partyProblem = partySize !== "" ? validatePartySize(partySize) : undefined;
  return (
    <div className="date-party">
      <Field
        label="Date"
        type="date"
        value={date}
        disabled={disabled}
        problem={dateIsBad ? FIELD_PROBLEMS.date : problemText(serverProblems?.date)}
        onChange={(event) => {
          setDateIsBad(event.currentTarget.validity.badInput);
          onDateChange(event.currentTarget.value);
        }}
      />
      <Field
        label="Party size"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={partySize}
        disabled={disabled}
        problem={problemText(partyProblem ?? serverProblems?.partySize)}
        onChange={(event) => {
          onPartySizeChange(event.currentTarget.value);
        }}
      />
    </div>
  );
}

function problemText(key: ProblemKey | undefined): string | undefined {
  return key ? FIELD_PROBLEMS[key] : undefined;
}
