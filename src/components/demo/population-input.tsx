import type { KeyboardEvent } from "react";

import { FieldLabel, TextInput } from "./controls";

/** "Population served" text field for clinics. Accepts "12,400", "12 400", or "12400". */
export function PopulationInput({
  id,
  value,
  onChange,
  onBlur,
  onKeyDown,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  error: string | null;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <FieldLabel htmlFor={id}>Population served</FieldLabel>
      <TextInput
        id={id}
        value={value}
        inputMode="numeric"
        autoComplete="off"
        placeholder="e.g. 12,000"
        onChange={(e) => onChange(e.target.value)}
        {...(onBlur ? { onBlur } : {})}
        {...(onKeyDown ? { onKeyDown } : {})}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs opacity-70">How many people rely on this clinic.</p>
      )}
    </div>
  );
}
