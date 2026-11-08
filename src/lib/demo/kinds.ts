/**
 * The three kinds of site in a medical supply network, and the one rule that links them:
 * supplies flow one way, port → warehouse → clinic.
 */

export const LOCATION_KINDS = ["port", "warehouse", "clinic"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const PORT_MODES = ["sea", "air"] as const;
export type PortMode = (typeof PORT_MODES)[number];

export const PORT_MODE_LABELS: Record<PortMode, string> = { sea: "Sea", air: "Air" };

type KindInfo = {
  label: string;
  plural: string;
  /** Square color on the map and swatch color in the panel. Reads on both the dark map and the
   *  aquamarine panel (swatches get an ink outline there). */
  color: string;
  description: string;
};

export const KIND_INFO: Record<LocationKind, KindInfo> = {
  port: {
    label: "Port",
    plural: "Ports",
    color: "#f2b33d",
    description: "Air or sea entry point for supplies. Open 24/7.",
  },
  warehouse: {
    label: "Warehouse",
    plural: "Warehouses",
    color: "#f2e5db",
    description: "Stores stock and keeps it cold. Supplied by ports.",
  },
  clinic: {
    label: "Clinic",
    plural: "Clinics",
    color: "#ff7aa8",
    description: "Treats patients. Supplied by warehouses.",
  },
};

/** The kind each kind supplies, or null for the end of the chain. */
export const SUPPLIES: Record<LocationKind, LocationKind | null> = {
  port: "warehouse",
  warehouse: "clinic",
  clinic: null,
};

/** The kind that supplies each kind, or null for the start of the chain. */
export const SUPPLIED_BY: Record<LocationKind, LocationKind | null> = {
  port: null,
  warehouse: "port",
  clinic: "warehouse",
};

export function isLocationKind(value: unknown): value is LocationKind {
  return typeof value === "string" && (LOCATION_KINDS as readonly string[]).includes(value);
}

export function isPortMode(value: unknown): value is PortMode {
  return typeof value === "string" && (PORT_MODES as readonly string[]).includes(value);
}

/** Whether a connection `from → to` is allowed: only port → warehouse and warehouse → clinic. */
export function canSupply(from: LocationKind, to: LocationKind): boolean {
  return SUPPLIES[from] === to;
}

/** "Port · Sea", "Warehouse", … */
export function kindLabel(location: { kind: LocationKind; portMode: PortMode | null }): string {
  const { label } = KIND_INFO[location.kind];
  return location.kind === "port" && location.portMode
    ? `${label} · ${PORT_MODE_LABELS[location.portMode]}`
    : label;
}
