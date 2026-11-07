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
  createdAt: string;
};

export type DemoState = {
  types: LocationType[];
  locations: Location[];
};

export type NewLocation = Omit<Location, "id" | "createdAt">;
