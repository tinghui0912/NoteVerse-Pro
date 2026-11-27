import { useId } from "react";
import { reasonError } from "../lib/validation";
export function ReasonField({
  value,
  onChange,
  disabled = false,
  label = "Reason",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const error = reasonError(value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        aria-describedby={`${id}-help`}
        aria-invalid={error ? true : undefined}
      />
      <small id={`${id}-help`} className={error ? "form-error" : "muted"}>
        {error ?? "The reason is recorded in the audit log."}
      </small>
    </div>
  );
}
