import {
  KIND_INFO,
  LOCATION_KINDS,
  PORT_MODE_LABELS,
  PORT_MODES,
  type LocationKind,
} from "@/lib/demo/kinds";
import { peopleLabel } from "@/lib/demo/population";
import type { Location } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import { SectionLabel } from "./controls";

/** A kind's colored square with its letter, as drawn on the map. */
export function KindMark({ kind, className }: { kind: LocationKind; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-ink font-display text-[9px] font-semibold leading-none text-ink",
        className,
      )}
      style={{ backgroundColor: KIND_INFO[kind].color }}
    >
      {KIND_INFO[kind].letter}
    </span>
  );
}

/** Options for the Type select. */
export const KIND_OPTIONS = LOCATION_KINDS.map((k) => ({
  value: k,
  label: KIND_INFO[k].label,
  color: KIND_INFO[k].color,
}));

/** Options for the Sea / Air toggle. */
export const PORT_MODE_OPTIONS = PORT_MODES.map((m) => ({ value: m, label: PORT_MODE_LABELS[m] }));

/** Drag data type for a kind dragged from the Location types list onto the map. */
export const DRAG_KIND_TYPE = "application/x-convoy-kind";

/** Side of the square that follows the pointer while a kind is dragged. */
const DRAG_SQUARE_PX = 22;

/**
 * The drag preview: the kind's square as drawn on the map (colour, letter, ink border, cream
 * ring), off-screen so only the browser's drag image shows it.
 */
function dragSquare(kind: LocationKind): HTMLElement {
  const square = document.createElement("div");
  square.setAttribute("aria-hidden", "true");
  square.textContent = KIND_INFO[kind].letter;
  Object.assign(square.style, {
    position: "fixed",
    top: "-200px",
    left: "-200px",
    width: `${DRAG_SQUARE_PX}px`,
    height: `${DRAG_SQUARE_PX}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    borderRadius: "2px",
    border: "2px solid var(--ink)",
    boxShadow: "0 0 0 1.5px var(--ink-foreground)",
    backgroundColor: KIND_INFO[kind].color,
    color: "var(--ink)",
    font: "600 11px/1 var(--font-inter-tight), sans-serif",
  });
  return square;
}

/**
 * The three fixed kinds of site, how many of each are on the map, and how supplies flow. When the
 * map is available, each kind can be dragged onto it to drop a new site at that exact point, or
 * clicked (or tapped, or pressed with Enter) and then placed with a click on the map.
 */
export function LocationKinds({
  locations,
  placing = null,
  onPlace,
}: {
  locations: Location[];
  /** The kind waiting for a click on the map, if any. */
  placing?: LocationKind | null;
  /** Start (or cancel) placing a kind. Absent when the map isn't available. */
  onPlace?: (kind: LocationKind | null) => void;
}) {
  const count = (filter: (l: Location) => boolean) =>
    String(locations.filter(filter).length).padStart(2, "0");
  const clinics = locations.filter((l) => l.kind === "clinic");
  const totalPopulation = clinics.reduce((sum, l) => sum + (l.population ?? 0), 0);
  const unset = clinics.filter((l) => l.population === null).length;

  return (
    <section aria-labelledby="kinds-heading" className="space-y-4">
      <h2 id="kinds-heading">
        <SectionLabel index="03" aside="Port → Warehouse → Clinic">
          Location types
        </SectionLabel>
      </h2>

      {onPlace && (
        <p className="text-sm opacity-80">
          Drag a type onto the map to drop a site exactly there, or click a type and then the map.
        </p>
      )}

      <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
        {LOCATION_KINDS.map((kind) => {
          const info = KIND_INFO[kind];
          const row = "grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-3";
          const content = (
            <>
              <KindMark kind={kind} className="translate-y-[2px]" />
              <span className="min-w-0">
                <span className="block text-lg leading-tight tracking-tight">{info.label}</span>
                <span className="block text-xs opacity-70">{info.description}</span>
                {kind === "port" && (
                  <span className="mt-1 block font-mono text-[11px] uppercase tracking-wider opacity-70">
                    {PORT_MODES.map(
                      (mode) =>
                        `${PORT_MODE_LABELS[mode]} ${count((l) => l.kind === "port" && l.portMode === mode)}`,
                    ).join(" · ")}
                  </span>
                )}
                {kind === "clinic" && (
                  <span className="mt-1 block font-mono text-[11px] uppercase tracking-wider opacity-70">
                    Serves {peopleLabel(totalPopulation)}
                    {unset > 0 && ` · ${unset} not set`}
                  </span>
                )}
              </span>
              <span
                className="font-mono text-[11px] uppercase tracking-wider opacity-70"
                aria-label={`${locations.filter((l) => l.kind === kind).length} on the map`}
              >
                {count((l) => l.kind === kind)}
              </span>
            </>
          );
          if (!onPlace) {
            return (
              <li key={kind} className={row}>
                {content}
              </li>
            );
          }
          const active = placing === kind;
          return (
            <li key={kind}>
              <button
                type="button"
                draggable
                aria-pressed={active}
                aria-label={`Place a ${info.label.toLowerCase()} on the map (${locations.filter((l) => l.kind === kind).length} there now). Drag it onto the map, or press and then click the map.`}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_KIND_TYPE, kind);
                  event.dataTransfer.effectAllowed = "copy";
                  // Drag just the kind's square, centred on the pointer, so the site lands
                  // exactly where it's let go (not the whole row).
                  const square = dragSquare(kind);
                  document.body.appendChild(square);
                  event.dataTransfer.setDragImage(
                    square,
                    square.offsetWidth / 2,
                    square.offsetHeight / 2,
                  );
                  // The browser has taken its picture; the element itself isn't needed.
                  setTimeout(() => square.remove(), 0);
                }}
                onClick={() => onPlace(active ? null : kind)}
                className={cn(
                  row,
                  "-mx-2 w-[calc(100%+1rem)] cursor-grab rounded-sm px-2 text-left transition-colors hover:bg-white/5 active:cursor-grabbing",
                  "outline-none focus-visible:outline-1 focus-visible:outline-foreground",
                  active && "bg-white/5 ring-1 ring-aqua",
                )}
              >
                {content}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
