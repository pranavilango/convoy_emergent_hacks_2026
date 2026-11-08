/**
 * Solar budget: what one solar power unit costs and how much money there is in total. Amounts
 * are US dollars with at most two decimal places, from 0.01 up to MAX_AMOUNT.
 */

export type Budget = {
  /** Cost of one solar power unit; null until entered. */
  unitCost: number | null;
  /** Total money available for solar; null until entered. */
  total: number | null;
};

export const EMPTY_BUDGET: Budget = { unitCost: null, total: null };

export const MAX_AMOUNT = 1_000_000_000_000;

export function isAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-6
  );
}

/** Strips a leading "$", thousands separators, and spaces: "$1,250.50" → "1250.50". */
function clean(text: string): string {
  return text
    .trim()
    .replace(/^\$/, "")
    .replace(/[\s,_]/g, "");
}

/** Reads a typed amount ("1,250", "$1250.50"). Null if it isn't a valid amount. */
export function parseAmount(text: string): number | null {
  const digits = clean(text);
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const n = Number(digits);
  return isAmount(n) ? n : null;
}

/** Why typed text isn't a valid amount, or null if it is. Empty is allowed (not set yet). */
export function amountError(text: string): string | null {
  const digits = clean(text);
  if (!digits) return null;
  if (!/^\d+(\.\d+)?$/.test(digits)) return "Use a number in dollars, e.g. 1,250 or 1250.50.";
  if (/\.\d{3,}$/.test(digits)) return "Use at most two decimal places (cents).";
  const n = Number(digits);
  if (n <= 0) return "Must be more than $0.";
  if (n > MAX_AMOUNT) return `Must be at most ${formatMoney(MAX_AMOUNT)}.`;
  return null;
}

/** "$1,250", "$1,250.50" */
export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Whole units the budget pays for, or null until both amounts are set. Computed in cents so
 *  e.g. $0.30 / $0.10 is 3, not 2. */
export function unitsAffordable({ unitCost, total }: Budget): number | null {
  if (unitCost === null || total === null) return null;
  return Math.floor(Math.round(total * 100) / Math.round(unitCost * 100));
}

/** Validates a saved budget. Anything malformed becomes "not set". */
export function parseBudget(value: unknown): Budget {
  if (typeof value !== "object" || value === null) return { ...EMPTY_BUDGET };
  const { unitCost, total } = value as Record<string, unknown>;
  return { unitCost: isAmount(unitCost) ? unitCost : null, total: isAmount(total) ? total : null };
}
