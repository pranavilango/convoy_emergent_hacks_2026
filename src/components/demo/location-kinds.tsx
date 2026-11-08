import { KIND_INFO, LOCATION_KINDS, PORT_MODE_LABELS, PORT_MODES } from "@/lib/demo/kinds";
import type { Location } from "@/lib/demo/types";

import { SectionLabel, Swatch } from "./controls";

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
              <Swatch color={info.color} className="translate-y-[1px]" />
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
