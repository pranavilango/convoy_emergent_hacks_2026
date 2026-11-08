import type { SolarAllocation } from "./analyze";

/** Just what the summary reads, so it works on the app's sites and on the API's network. */
type Site = { id: string; name: string; kind: string; population?: number | null };
type Link = { fromId: string; toId: string };

/**
 * What an analysis means, in the terms the popup (and Gemini) use. Every number comes from the
 * engine's answer; this only names, sorts, and compares them.
 *
 * "Port-to-clinic time": a shipment leaves the port at each hour of the day, drives (straight
 * line, 60 km/h), waits at the warehouse until it's staffed and powered, drives on, and waits at
 * the clinic the same way. A clinic's time is the average of those 24 trips; the overall average
 * counts each clinic by the people it serves.
 *
 * Every time is rounded to 0.1 h first, and every difference and percentage is worked out from
 * the rounded times, so the arithmetic on screen adds up when someone checks it by hand
 * (10.3 → 6.9 is "3.4 h sooner", and 3.8 h driving + 6.5 h waiting is 10.3 h).
 */
export type AnalysisSummary = {
  /** Average port-to-clinic time without solar, and with the plan (hours). */
  before: number;
  after: number;
  /** before − after, and as a share of before. */
  saved: number;
  share: number;
  /** Driving vs waiting for a site to be staffed and powered. Solar only changes the waiting. */
  split: { driving: number; waitingBefore: number; waitingAfter: number } | null;
  /** Every clinic: its own time before and after; clinics that get faster first, biggest first. */
  clinics: ClinicTimes[] | null;
  /** People at clinics whose time drops, and at all clinics. */
  peopleSooner: number | null;
  peopleTotal: number;
  /** The obvious alternative: solar on the clinics serving the most people. */
  obvious: ObviousChoice | null;
};

export type ClinicTimes = {
  id: string;
  name: string;
  people: number | null;
  before: number;
  after: number;
  /** Whether the plan makes it faster (at the 0.1 h shown). */
  faster: boolean;
};

export type ObviousChoice = {
  /** Names of the clinics it would equip. */
  sites: string[];
  hours: number;
  /** How much faster Convoy's plan is on average (≤ 0 if it isn't). */
  convoyFasterBy: number;
  /** It picks exactly the same sites as Convoy. */
  sameAsPlan: boolean;
  /** Chosen warehouses and the clinics each one speeds up: why a network beats a ranking. */
  warehouses: { name: string; clinics: string[] }[];
};

/** Hours to one decimal place, as shown. */
const r1 = (hours: number) => Math.round(hours * 10) / 10;

export function summarizeAnalysis(
  allocation: SolarAllocation,
  locations: readonly Site[],
  connections: readonly Link[],
): AnalysisSummary {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "an unnamed site";
  const before = r1(allocation.baseline_weighted_hours);
  const after = r1(allocation.optimized_weighted_hours);
  const peopleTotal = locations.reduce(
    (sum, l) => sum + (l.kind === "clinic" ? (l.population ?? 0) : 0),
    0,
  );

  // Driving is the same with and without solar; the waiting is what's left of each total.
  const driving = allocation.baseline_breakdown
    ? Math.min(r1(allocation.baseline_breakdown.travel_hours), after)
    : null;
  const split =
    driving !== null && allocation.optimized_breakdown
      ? { driving, waitingBefore: r1(before - driving), waitingAfter: r1(after - driving) }
      : null;

  const clinics =
    allocation.destinations?.map((d): ClinicTimes => {
      const site = byId.get(d.id);
      const people = site?.kind === "clinic" ? (site.population ?? null) : null;
      return {
        id: d.id,
        name: nameOf(d.id),
        people,
        before: r1(d.baseline.total_hours),
        after: r1(d.optimized.total_hours),
        faster: r1(d.optimized.total_hours) < r1(d.baseline.total_hours),
      };
    }) ?? null;
  clinics?.sort(
    (a, b) =>
      Number(b.faster) - Number(a.faster) ||
      (b.people ?? 0) - (a.people ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const chosen = new Set(allocation.selected);
  const warehouses = allocation.selected
    .filter((id) => byId.get(id)?.kind === "warehouse")
    .map((id) => ({
      name: nameOf(id),
      clinics: connections.filter((c) => c.fromId === id).map((c) => nameOf(c.toId)),
    }));
  const obvious = allocation.priority_first
    ? {
        sites: allocation.priority_first.selected.map(nameOf),
        hours: r1(allocation.priority_first.weighted_hours),
        convoyFasterBy: r1(r1(allocation.priority_first.weighted_hours) - after),
        sameAsPlan:
          allocation.priority_first.selected.length === chosen.size &&
          allocation.priority_first.selected.every((id) => chosen.has(id)),
        warehouses,
      }
    : null;

  return {
    before,
    after,
    saved: r1(before - after),
    share: before > 0 ? r1(before - after) / before : 0,
    split,
    clinics,
    peopleSooner: clinics
      ? clinics.filter((c) => c.faster).reduce((sum, c) => sum + (c.people ?? 0), 0)
      : null,
    peopleTotal,
    obvious,
  };
}

/** "3.5 h" */
export const formatHours = (hours: number) => `${hours.toFixed(1)} h`;
