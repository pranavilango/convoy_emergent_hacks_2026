import type { Location } from "./types";

/** How many people a clinic serves: a whole number from 1 to MAX_POPULATION. */

export const MAX_POPULATION = 100_000_000;

export function isPopulation(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_POPULATION
  );
}

/** Reads what someone typed ("12,400", "12 400", "12400"). Null if it isn't a valid population. */
export function parsePopulation(text: string): number | null {
  const digits = text.trim().replace(/[\s,_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return isPopulation(n) ? n : null;
}

/** Why typed text isn't a valid population, or null if it is. */
export function populationError(text: string): string | null {
  const digits = text.trim().replace(/[\s,_]/g, "");
  if (!digits) return "Enter how many people the clinic serves.";
  if (!/^\d+$/.test(digits)) return "Use a whole number of people, e.g. 12,000.";
  const n = Number(digits);
  if (n < 1) return "A clinic serves at least 1 person.";
  if (n > MAX_POPULATION) return `That's more than ${formatPopulation(MAX_POPULATION)}.`;
  return null;
}

/** "12,400" */
export function formatPopulation(n: number): string {
  return n.toLocaleString("en-US");
}

/** "1 person", "12,400 people" */
export function peopleLabel(n: number): string {
  return `${formatPopulation(n)} ${n === 1 ? "person" : "people"}`;
}

export function totalClinicPopulation(locations: readonly Location[]): number {
  return locations.reduce(
    (total, location) => (location.kind === "clinic" ? total + (location.population ?? 0) : total),
    0,
  );
}

export function formatPeopleHours(value: number): string {
  const thousands = value / 1000;
  return `${thousands.toLocaleString("en-US", { maximumFractionDigits: 1 })}k people-hours`;
}
