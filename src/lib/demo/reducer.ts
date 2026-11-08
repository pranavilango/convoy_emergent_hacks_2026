import { EMPTY_BUDGET, isAmount, parseBudget } from "./budget";
import { findConnection, involves } from "./graph";
import { ALWAYS_OPEN, cloneHours, DEFAULT_HOURS, hoursError, parseHours } from "./hours";
import type { WeeklyHours } from "./hours";
import { canSupply, isLocationKind, isPortMode, type LocationKind, type PortMode } from "./kinds";
import { isPopulation } from "./population";
import { isGridPower, type GridPower } from "./power";
import type { Connection, DemoState, Location, NewLocation } from "./types";

export const INITIAL_STATE: DemoState = { locations: [], connections: [], budget: EMPTY_BUDGET };

export const MAX_LOCATION_NAME_LENGTH = 80;

export type DemoAction =
  | { type: "addLocation"; id: string; createdAt: string; location: NewLocation }
  | {
      type: "updateLocation";
      id: string;
      name?: string;
      /** Changing kind removes connections the new kind can't have, and resets the hours and
       *  port mode to fit it (ports: 24/7 and `portMode`, default sea; others: `hours`, default
       *  weekdays 9–5). */
      kind?: LocationKind;
      portMode?: PortMode;
      /** Refused for ports, which are always open. */
      hours?: WeeklyHours;
      /** Refused for ports. Null means a reliable grid. A site that becomes a port loses it. */
      gridPower?: GridPower;
      /** Clinics only. A site that stops being a clinic loses its population; one that becomes a
       *  clinic starts without one unless it's given here. */
      population?: number;
    }
  | { type: "removeLocation"; id: string }
  /** Undo a removal: put the location back at `index` and its connections back where they were
   *  (each at its old position), as long as nothing has taken their place since. */
  | {
      type: "restoreLocation";
      location: Location;
      index: number;
      connections: { connection: Connection; index: number }[];
    }
  /** Only port → warehouse and warehouse → clinic. Duplicates are ignored. */
  | { type: "addConnection"; id: string; fromId: string; toId: string }
  | { type: "removeConnection"; id: string }
  /** Each amount: a positive dollar amount (cents at most), or null to clear it. */
  | { type: "setBudget"; unitCost?: number | null; total?: number | null }
  | { type: "replace"; state: DemoState };

export function normalizeName(name: string, max: number): string {
  return name.trim().replace(/\s+/g, " ").slice(0, max);
}

/** Connections of `locationId` that wouldn't be allowed if it became `kind`. */
export function connectionsBrokenByKind(
  state: Pick<DemoState, "locations" | "connections">,
  locationId: string,
  kind: LocationKind,
): Connection[] {
  const kindOf = (id: string) =>
    id === locationId ? kind : state.locations.find((l) => l.id === id)?.kind;
  return state.connections.filter((c) => {
    if (!involves(c, locationId)) return false;
    const from = kindOf(c.fromId);
    const to = kindOf(c.toId);
    return !from || !to || !canSupply(from, to);
  });
}

/**
 * Pure state transitions. Invalid actions (unknown ids, empty names, bad hours, connections that
 * break the port → warehouse → clinic chain) return the state unchanged, so the UI can't put the
 * store into an inconsistent shape.
 */
export function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "addLocation": {
      const { location } = action;
      if (!isLocationKind(location.kind)) return state;
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return state;
      if (state.locations.some((l) => l.id === action.id)) return state;
      const name =
        normalizeName(location.name, MAX_LOCATION_NAME_LENGTH) ||
        normalizeName(location.address, MAX_LOCATION_NAME_LENGTH);
      if (!name) return state;
      const isPort = location.kind === "port";
      if (isPort && !isPortMode(location.portMode)) return state;
      if (!isPort && hoursError(location.hours)) return state;
      if (location.gridPower !== null && (isPort || !isGridPower(location.gridPower))) return state;
      const isClinic = location.kind === "clinic";
      if (isClinic && !isPopulation(location.population)) return state;
      const added: Location = {
        ...location,
        name,
        portMode: isPort ? location.portMode : null,
        population: isClinic ? location.population : null,
        hours: cloneHours(isPort ? ALWAYS_OPEN : location.hours),
        gridPower: location.gridPower && { ...location.gridPower },
        id: action.id,
        createdAt: action.createdAt,
      };
      return { ...state, locations: [...state.locations, added] };
    }

    case "updateLocation": {
      const current = state.locations.find((l) => l.id === action.id);
      if (!current) return state;
      const next = { ...current };
      if (action.name !== undefined) {
        const name = normalizeName(action.name, MAX_LOCATION_NAME_LENGTH);
        if (!name) return state;
        next.name = name;
      }
      const kindChanged = action.kind !== undefined && action.kind !== current.kind;
      if (action.kind !== undefined) {
        if (!isLocationKind(action.kind)) return state;
        next.kind = action.kind;
      }
      if (action.portMode !== undefined && !isPortMode(action.portMode)) return state;
      if (action.hours !== undefined && hoursError(action.hours)) return state;
      if (action.gridPower != null && !isGridPower(action.gridPower)) return state;

      if (next.kind === "port") {
        if (action.hours !== undefined || action.gridPower !== undefined) return state;
        next.portMode = action.portMode ?? current.portMode ?? "sea";
        next.hours = cloneHours(ALWAYS_OPEN);
        next.gridPower = null;
      } else {
        if (action.portMode !== undefined) return state;
        next.portMode = null;
        if (action.hours !== undefined) next.hours = cloneHours(action.hours);
        else if (kindChanged && current.kind === "port") next.hours = cloneHours(DEFAULT_HOURS);
        if (action.gridPower !== undefined)
          next.gridPower = action.gridPower && { ...action.gridPower };
      }

      if (action.population !== undefined) {
        if (next.kind !== "clinic" || !isPopulation(action.population)) return state;
        next.population = action.population;
      } else if (next.kind !== "clinic") {
        next.population = null;
      }

      const locations = state.locations.map((l) => (l.id === action.id ? next : l));
      if (!kindChanged) return { ...state, locations };
      const broken = new Set(connectionsBrokenByKind(state, action.id, next.kind).map((c) => c.id));
      return {
        ...state,
        locations,
        connections: broken.size
          ? state.connections.filter((c) => !broken.has(c.id))
          : state.connections,
      };
    }

    case "removeLocation": {
      if (!state.locations.some((l) => l.id === action.id)) return state;
      return {
        ...state,
        locations: state.locations.filter((l) => l.id !== action.id),
        connections: state.connections.filter((c) => !involves(c, action.id)),
      };
    }

    case "restoreLocation": {
      const { location } = action;
      if (!isLocationKind(location.kind) || state.locations.some((l) => l.id === location.id)) {
        return state;
      }
      const locations = [...state.locations];
      locations.splice(Math.max(0, Math.min(action.index, locations.length)), 0, location);
      const ids = new Set(locations.map((l) => l.id));
      const connections = [...state.connections];
      for (const { connection, index } of [...action.connections].sort(
        (a, b) => a.index - b.index,
      )) {
        if (!ids.has(connection.fromId) || !ids.has(connection.toId)) continue;
        if (
          connections.some(
            (c) =>
              c.id === connection.id ||
              (c.fromId === connection.fromId && c.toId === connection.toId),
          )
        ) {
          continue;
        }
        connections.splice(Math.max(0, Math.min(index, connections.length)), 0, connection);
      }
      return { ...state, locations, connections };
    }

    case "addConnection": {
      const { fromId, toId } = action;
      if (state.connections.some((c) => c.id === action.id)) return state;
      const from = state.locations.find((l) => l.id === fromId);
      const to = state.locations.find((l) => l.id === toId);
      if (!from || !to || !canSupply(from.kind, to.kind)) return state;
      if (findConnection(state.connections, fromId, toId)) return state;
      const connection: Connection = { id: action.id, fromId, toId };
      return { ...state, connections: [...state.connections, connection] };
    }

    case "removeConnection": {
      if (!state.connections.some((c) => c.id === action.id)) return state;
      return { ...state, connections: state.connections.filter((c) => c.id !== action.id) };
    }

    case "setBudget": {
      const next = { ...state.budget };
      for (const key of ["unitCost", "total"] as const) {
        const value = action[key];
        if (value === undefined) continue;
        if (value !== null && !isAmount(value)) return state;
        next[key] = value;
      }
      if (next.unitCost === state.budget.unitCost && next.total === state.budget.total) {
        return state;
      }
      return { ...state, budget: next };
    }

    case "replace":
      return action.state;
  }
}

// --- Parsing saved state -------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocation(value: unknown): Location | null {
  if (!isRecord(value)) return null;
  const { id, name, address, placeId, lat, lng, kind, portMode, population, createdAt } = value;
  if (typeof id !== "string" || !id) return null;
  if (typeof name !== "string" || !name.trim() || typeof address !== "string") return null;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  if (!isLocationKind(kind) || typeof createdAt !== "string") return null;
  const isPort = kind === "port";
  const mode = isPort && isPortMode(portMode) ? portMode : null;
  if (isPort && !mode) return null;
  const hours = isPort ? cloneHours(ALWAYS_OPEN) : parseHours(value["hours"]);
  if (!hours) return null;
  return {
    id,
    name: normalizeName(name, MAX_LOCATION_NAME_LENGTH),
    address,
    ...(typeof placeId === "string" && placeId ? { placeId } : {}),
    lat,
    lng,
    kind,
    portMode: mode,
    hours,
    // Sites saved before grid power existed load with a reliable grid.
    gridPower: !isPort && isGridPower(value["gridPower"]) ? { ...value["gridPower"] } : null,
    // Clinics saved before population existed load as "not set yet".
    population: kind === "clinic" && isPopulation(population) ? population : null,
    createdAt,
  };
}

function parseConnection(value: unknown, kindById: Map<string, LocationKind>): Connection | null {
  if (!isRecord(value)) return null;
  const { id, fromId, toId } = value;
  if (typeof id !== "string" || !id || typeof fromId !== "string" || typeof toId !== "string") {
    return null;
  }
  const from = kindById.get(fromId);
  const to = kindById.get(toId);
  if (!from || !to || !canSupply(from, to)) return null;
  return { id, fromId, toId };
}

/**
 * Validates state read from storage. Drops anything malformed (or any connection that breaks the
 * supply chain) rather than failing outright, so one bad record doesn't wipe everything else.
 * Returns null when there's nothing usable at all.
 */
export function parseState(value: unknown): DemoState | null {
  if (!isRecord(value) || !Array.isArray(value["locations"])) return null;
  const locations: Location[] = [];
  const kindById = new Map<string, LocationKind>();
  for (const raw of value["locations"]) {
    const l = parseLocation(raw);
    if (!l || kindById.has(l.id)) continue;
    kindById.set(l.id, l.kind);
    locations.push(l);
  }
  const rawConnections = value["connections"];
  const connections: Connection[] = [];
  const seenConnectionIds = new Set<string>();
  const seenPairs = new Set<string>();
  if (Array.isArray(rawConnections)) {
    for (const raw of rawConnections) {
      const connection = parseConnection(raw, kindById);
      if (!connection || seenConnectionIds.has(connection.id)) continue;
      const pair = JSON.stringify([connection.fromId, connection.toId]);
      if (seenPairs.has(pair)) continue;
      seenConnectionIds.add(connection.id);
      seenPairs.add(pair);
      connections.push(connection);
    }
  }
  return { locations, connections, budget: parseBudget(value["budget"]) };
}
