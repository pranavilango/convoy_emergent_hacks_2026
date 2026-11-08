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

/** The three fixed kinds of site, how many of each are on the map, and how supplies flow. */
export function LocationKinds({ locations }: { locations: Location[] }) {
  const count = (filter: (l: Location) => boolean) =>
    String(locations.filter(filter).length).padStart(2, "0");
  const clinics = locations.filter((l) => l.kind === "clinic");
  const totalPopulation = clinics.reduce((sum, l) => sum + (l.population ?? 0), 0);
  const unset = clinics.filter((l) => l.population === null).length;

  return (
    <section aria-labelledby="kinds-heading" className="space-y-4">
      <h2 id="kinds-heading">
        <SectionLabel index="02" aside="Port → Warehouse → Clinic">
          Location types
        </SectionLabel>
      </h2>

      <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
        {LOCATION_KINDS.map((kind) => {
          const info = KIND_INFO[kind];
          return (
            <li key={kind} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-3">
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
