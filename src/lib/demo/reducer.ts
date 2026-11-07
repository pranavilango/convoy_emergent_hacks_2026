import { isTypeColor } from "./colors";
import type { DemoState, Location, LocationType, NewLocation } from "./types";

export const DEFAULT_TYPES: LocationType[] = [
  { id: "factory", name: "Factory", color: "#f2b33d" },
  { id: "warehouse", name: "Warehouse", color: "#5cc8ff" },
  { id: "retail-store", name: "Retail store", color: "#4fd1a5" },
];

export const INITIAL_STATE: DemoState = { types: DEFAULT_TYPES, locations: [] };

export const MAX_TYPE_NAME_LENGTH = 32;
export const MAX_LOCATION_NAME_LENGTH = 80;

export type DemoAction =
  | { type: "addType"; id: string; name: string; color: string }
  | { type: "updateType"; id: string; name?: string; color?: string }
  /** Locations of the removed type are moved to `reassignTo`, or deleted when it is omitted. */
  | { type: "removeType"; id: string; reassignTo?: string }
  | { type: "addLocation"; id: string; createdAt: string; location: NewLocation }
  | { type: "updateLocation"; id: string; name?: string; typeId?: string }
  | { type: "removeLocation"; id: string }
  | { type: "replace"; state: DemoState };

export function normalizeName(name: string, max: number): string {
  return name.trim().replace(/\s+/g, " ").slice(0, max);
}

function typeNameTaken(types: LocationType[], name: string, exceptId?: string): boolean {
  const key = name.toLowerCase();
  return types.some((t) => t.id !== exceptId && t.name.toLowerCase() === key);
}

/** Why a proposed type name can't be used, or null if it's fine. */
export function typeNameError(
  types: LocationType[],
  rawName: string,
  exceptId?: string,
): string | null {
  const name = normalizeName(rawName, MAX_TYPE_NAME_LENGTH);
  if (!name) return "Give the type a name.";
  if (typeNameTaken(types, name, exceptId)) return `“${name}” already exists.`;
  return null;
}

/**
 * Pure state transitions. Invalid actions (unknown ids, empty or duplicate names, bad colors)
 * return the state unchanged, so the UI can't put the store into an inconsistent shape.
 */
export function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "addType": {
      const name = normalizeName(action.name, MAX_TYPE_NAME_LENGTH);
      if (!name || typeNameTaken(state.types, name) || !isTypeColor(action.color)) return state;
      if (state.types.some((t) => t.id === action.id)) return state;
      return { ...state, types: [...state.types, { id: action.id, name, color: action.color }] };
    }

    case "updateType": {
      const current = state.types.find((t) => t.id === action.id);
      if (!current) return state;
      const next = { ...current };
      if (action.name !== undefined) {
        const name = normalizeName(action.name, MAX_TYPE_NAME_LENGTH);
        if (!name || typeNameTaken(state.types, name, action.id)) return state;
        next.name = name;
      }
      if (action.color !== undefined) {
        if (!isTypeColor(action.color)) return state;
        next.color = action.color;
      }
      return { ...state, types: state.types.map((t) => (t.id === action.id ? next : t)) };
    }

    case "removeType": {
      if (!state.types.some((t) => t.id === action.id)) return state;
      const { reassignTo } = action;
      if (
        reassignTo !== undefined &&
        (reassignTo === action.id || !state.types.some((t) => t.id === reassignTo))
      ) {
        return state;
      }
      const types = state.types.filter((t) => t.id !== action.id);
      const locations =
        reassignTo === undefined
          ? state.locations.filter((l) => l.typeId !== action.id)
          : state.locations.map((l) => (l.typeId === action.id ? { ...l, typeId: reassignTo } : l));
      return { types, locations };
    }

    case "addLocation": {
      const { location } = action;
      if (!state.types.some((t) => t.id === location.typeId)) return state;
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return state;
      if (state.locations.some((l) => l.id === action.id)) return state;
      const name =
        normalizeName(location.name, MAX_LOCATION_NAME_LENGTH) ||
        normalizeName(location.address, MAX_LOCATION_NAME_LENGTH);
      if (!name) return state;
      const added: Location = { ...location, name, id: action.id, createdAt: action.createdAt };
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
      if (action.typeId !== undefined) {
        if (!state.types.some((t) => t.id === action.typeId)) return state;
        next.typeId = action.typeId;
      }
      return { ...state, locations: state.locations.map((l) => (l.id === action.id ? next : l)) };
    }

    case "removeLocation": {
      if (!state.locations.some((l) => l.id === action.id)) return state;
      return { ...state, locations: state.locations.filter((l) => l.id !== action.id) };
    }

    case "replace":
      return action.state;
  }
}

// --- Parsing saved state -------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseType(value: unknown): LocationType | null {
  if (!isRecord(value)) return null;
  const { id, name, color } = value;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) return null;
  if (!isTypeColor(color)) return null;
  return { id, name: normalizeName(name, MAX_TYPE_NAME_LENGTH), color };
}

function parseLocation(value: unknown, typeIds: Set<string>): Location | null {
  if (!isRecord(value)) return null;
  const { id, name, address, placeId, lat, lng, typeId, createdAt } = value;
  if (typeof id !== "string" || !id) return null;
  if (typeof name !== "string" || !name.trim() || typeof address !== "string") return null;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  if (typeof typeId !== "string" || !typeIds.has(typeId)) return null;
  if (typeof createdAt !== "string") return null;
  return {
    id,
    name: normalizeName(name, MAX_LOCATION_NAME_LENGTH),
    address,
    ...(typeof placeId === "string" && placeId ? { placeId } : {}),
    lat,
    lng,
    typeId,
    createdAt,
  };
}

/**
 * Validates state read from storage. Drops anything malformed rather than failing outright, so
 * one bad record (or a hand-edited value) doesn't wipe the user's other locations.
 * Returns null when there's nothing usable at all.
 */
export function parseState(value: unknown): DemoState | null {
  if (!isRecord(value) || !Array.isArray(value["types"]) || !Array.isArray(value["locations"])) {
    return null;
  }
  const types: LocationType[] = [];
  const seenTypeIds = new Set<string>();
  const seenTypeNames = new Set<string>();
  for (const raw of value["types"]) {
    const t = parseType(raw);
    if (!t || seenTypeIds.has(t.id) || seenTypeNames.has(t.name.toLowerCase())) continue;
    seenTypeIds.add(t.id);
    seenTypeNames.add(t.name.toLowerCase());
    types.push(t);
  }
  const locations: Location[] = [];
  const seenLocationIds = new Set<string>();
  for (const raw of value["locations"]) {
    const l = parseLocation(raw, seenTypeIds);
    if (!l || seenLocationIds.has(l.id)) continue;
    seenLocationIds.add(l.id);
    locations.push(l);
  }
  return { types, locations };
}
