import type { WeeklyHours } from "./hours";
import type { LocationKind, PortMode } from "./kinds";

export type Location = {
  id: string;
  /** Defaults to the Google place name; the user can change it. */
  name: string;
  address: string;
  /** Google place ID, kept so we can fetch more place details later. */
  placeId?: string;
  lat: number;
  lng: number;
  kind: LocationKind;
  /** Air or sea for ports; null for every other kind. */
  portMode: PortMode | null;
  /** Weekly working hours. Always 24/7 for ports. */
  hours: WeeklyHours;
  /** People a clinic serves (whole number, 1–100,000,000). Null for ports and warehouses, and
   *  for a clinic that hasn't been given one yet (e.g. just changed from another kind). */
  population: number | null;
  createdAt: string;
};

/**
 * A directed supply link `fromId → toId`: port → warehouse or warehouse → clinic. Its distance
 * isn't stored; it's the straight line between the two locations (see `distanceKm`).
 */
export type Connection = {
  id: string;
  fromId: string;
  toId: string;
};

export type DemoState = {
  locations: Location[];
  connections: Connection[];
};

export type NewLocation = Omit<Location, "id" | "createdAt">;
