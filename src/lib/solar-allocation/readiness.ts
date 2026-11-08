import { DAYS, formatRange, isOvernight } from "@/lib/demo/hours";
import type { Connection, Location } from "@/lib/demo/types";

/**
 * Why the network can't be analyzed yet, in plain words and by site name. Mirrors the
 * optimizer's rules (see API.md) so problems show up before Analyze, not as an error after it:
 * - at least one port, one warehouse, and one clinic;
 * - every port supplies a warehouse, every warehouse is supplied and supplies a clinic, and
 *   every clinic is supplied;
 * - all sites form one connected network;
 * - warehouses and clinics are open at least one day, with no overnight shifts;
 * - every clinic says how many people it serves;
 * - the budget covers at least one solar unit.
 * Returns an empty list when the network is ready.
 */
export function analysisIssues(
  locations: readonly Location[],
  connections: readonly Connection[],
  solarUnits: number | null,
): string[] {
  const issues: string[] = [];
  const has = (kind: Location["kind"]) => locations.some((l) => l.kind === kind);
  const missing = (["port", "warehouse", "clinic"] as const).filter((kind) => !has(kind));
  if (missing.length) {
    issues.push(`Add at least one ${missing.join(", one ")}.`);
  }

  const supplies = (id: string) => connections.some((c) => c.fromId === id);
  const supplied = (id: string) => connections.some((c) => c.toId === id);
  for (const l of locations) {
    if (l.kind === "port" && !supplies(l.id)) {
      issues.push(`${l.name} doesn't supply any warehouse yet.`);
    }
    if (l.kind === "warehouse" && !supplied(l.id)) {
      issues.push(`${l.name} has no port supplying it.`);
    }
    if (l.kind === "warehouse" && !supplies(l.id)) {
      issues.push(`${l.name} doesn't supply any clinic yet.`);
    }
    if (l.kind === "clinic" && !supplied(l.id)) {
      issues.push(`${l.name} has no warehouse supplying it.`);
    }
  }

  const groups = connectedGroups(locations, connections);
  if (locations.length > 0 && groups > 1) {
    issues.push(
      `Your sites form ${groups} separate networks. Link them into one, or remove the sites you aren't analyzing.`,
    );
  }

  for (const l of locations) {
    if (l.kind === "port") continue;
    const ranges = DAYS.flatMap((d) => l.hours[d]);
    if (ranges.length === 0) {
      issues.push(`${l.name} is closed every day. Give it opening hours.`);
      continue;
    }
    const overnight = ranges.find(isOvernight);
    if (overnight) {
      issues.push(
        `${l.name} has an overnight shift (${formatRange(overnight)}), which the optimizer can't model yet. End it at midnight.`,
      );
    }
  }

  for (const l of locations) {
    if (l.kind === "clinic" && l.population === null) {
      issues.push(`Set how many people ${l.name} serves.`);
    }
  }

  if (solarUnits === null) {
    issues.push("Enter the cost per solar unit and the total budget.");
  } else if (solarUnits < 1) {
    issues.push("The budget must cover at least one solar unit.");
  }

  return issues;
}

/** Number of separate networks, treating links as two-way. */
function connectedGroups(
  locations: readonly Location[],
  connections: readonly Connection[],
): number {
  const parent = new Map(locations.map((l) => [l.id, l.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const c of connections) {
    if (parent.has(c.fromId) && parent.has(c.toId)) parent.set(find(c.fromId), find(c.toId));
  }
  return new Set(locations.map((l) => find(l.id))).size;
}
