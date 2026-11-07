import type { WeeklyHours } from "./hours";

export type LocationType = {
  id: string;
  name: string;
  /** Hex color, one of TYPE_COLORS. */
  color: string;
};

export type Location = {
  id: string;
  /** Defaults to the Google place name; the user can change it. */
  name: string;
  address: string;
  /** Google place ID, kept so we can fetch more place details later. */
  placeId?: string;
  lat: number;
  lng: number;
  typeId: string;
  /** Weekly working hours. null only for locations saved before hours existed. */
  hours: WeeklyHours | null;
  createdAt: string;
};

/**
 * A directed link `fromId → toId` between two locations (e.g. factory → warehouse). It only
 * records that the link exists: no distance or cost. A→B and B→A are separate connections.
 */
export type Connection = {
  id: string;
  fromId: string;
  toId: string;
};

export type DemoState = {
  types: LocationType[];
  locations: Location[];
  connections: Connection[];
};

/** New locations must come with working hours. */
export type NewLocation = Omit<Location, "id" | "createdAt" | "hours"> & { hours: WeeklyHours };
