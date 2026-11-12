import { useId, type InputHTMLAttributes } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  /** Catalog text of the problem, without the "Error:" prefix. */
  problem?: string;
}

export function Field({ label, hint, problem, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const describedBy = [hint ? hintId : "", problem ? problemId : ""].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      <input
        {...input}
        id={id}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {problem ? (
        <p id={problemId} className="field__problem">
          Error: {problem}
        </p>
      ) : null}
    </div>
  );
}
