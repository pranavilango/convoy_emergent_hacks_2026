"use client";

import { useState } from "react";

import {
  amountError,
  formatMoney,
  parseAmount,
  unitsAffordable,
  type Budget,
} from "@/lib/demo/budget";
import { demoActions } from "@/lib/demo/store";

import { FieldLabel, SectionLabel, TextInput } from "./controls";

/** Solar budget inputs: cost per unit and total money, with how many units that buys. */
export function BudgetSection({ budget }: { budget: Budget }) {
  const units = unitsAffordable(budget);
  const leftover =
    units !== null && budget.unitCost !== null && budget.total !== null
      ? (Math.round(budget.total * 100) - units * Math.round(budget.unitCost * 100)) / 100
      : null;

  return (
    <section aria-labelledby="budget-heading" className="space-y-4">
      <h2 id="budget-heading">
        <SectionLabel index="01" aside="USD">
          Budget
        </SectionLabel>
      </h2>
      <p className="text-sm opacity-80">
        What one solar power unit costs, and how much money there is to spend on solar.
      </p>

      <AmountField
        id="budget-unit-cost"
        label="Cost per solar unit"
        hint="Price of one unit, installed."
        saved={budget.unitCost}
        onCommit={demoActions.setUnitCost}
      />
      <AmountField
        id="budget-total"
        label="Total budget"
        hint="All the money available for solar."
        saved={budget.total}
        onCommit={demoActions.setTotalBudget}
      />

      <p
        role="status"
        className="border-y border-foreground/30 py-3 font-mono text-[11px] uppercase tracking-wider"
      >
        {units === null
          ? "Enter both amounts to see how many units the budget covers."
          : units === 0
            ? `Not enough for one unit (${formatMoney(budget.unitCost!)}).`
            : `Covers ${units.toLocaleString("en-US")} ${units === 1 ? "unit" : "units"}${
                leftover ? ` · ${formatMoney(leftover)} left over` : ""
              }`}
      </p>
    </section>
  );
}

/** "1,250" or "1,250.50" (no currency sign; the field is labelled USD). */
function formatPlain(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** A dollar amount saved on blur or Enter. Clearing the field clears the amount; Escape puts
 *  the saved value back. */
function AmountField({
  id,
  label,
  hint,
  saved,
  onCommit,
}: {
  id: string;
  label: string;
  hint: string;
  saved: number | null;
  onCommit: (value: number | null) => void;
}) {
  const savedText = saved === null ? "" : formatPlain(saved);
  const [text, setText] = useState(savedText);
  const [error, setError] = useState<string | null>(null);
  // Follow the saved amount when it changes underneath us: the browser's saved data arriving
  // after the first render, another tab, or our own commit.
  const [shown, setShown] = useState(saved);
  if (saved !== shown) {
    setShown(saved);
    setText(savedText);
    setError(null);
  }
  const errorId = `${id}-error`;

  function commit() {
    if (text.trim() === savedText) {
      setError(null);
      return;
    }
    if (!text.trim()) {
      setError(null);
      onCommit(null);
      return;
    }
    const value = parseAmount(text);
    if (value === null) {
      setError(amountError(text) ?? "Enter a valid amount.");
      return;
    }
    setError(null);
    onCommit(value);
    setText(formatPlain(value));
  }

  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {/* The underline runs under the "$" too, full width like every other field's. */}
      <div className="flex items-baseline gap-1.5 border-b border-foreground focus-within:shadow-[0_1px_0_0_var(--color-foreground)]">
        <span aria-hidden className="text-base">
          $
        </span>
        <TextInput
          className="border-b-0 focus-visible:shadow-none"
          id={id}
          value={text}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setText(savedText);
              setError(null);
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs opacity-70">{hint}</p>
      )}
    </div>
  );
}
