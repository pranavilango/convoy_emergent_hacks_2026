"use client";

import { useState } from "react";

import { findConnection } from "@/lib/demo/graph";
import { demoActions } from "@/lib/demo/store";
import type { Connection, Location, LocationType } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import { Button, focusRing, SectionLabel, Swatch } from "./controls";
import { Select } from "./select";

export function ConnectionsManager({
  locations,
  types,
  connections,
  selectedConnectionId,
  onSelectConnection,
}: {
  locations: Location[];
  types: LocationType[];
  connections: Connection[];
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
}) {
  const [firstId, setFirstId] = useState<string | undefined>(undefined);
  const [secondId, setSecondId] = useState<string | undefined>(undefined);

  const locationById = new Map(locations.map((l) => [l.id, l]));
  const colorOf = (l: Location) => types.find((t) => t.id === l.typeId)?.color;
  const option = (l: Location) => ({
    value: l.id,
    label: l.name,
    ...(colorOf(l) ? { color: colorOf(l)! } : {}),
  });

  const first = firstId && locationById.has(firstId) ? firstId : undefined;
  // Only offer destinations this location doesn't already point to.
  const partners = first
    ? locations.filter((l) => l.id !== first && !findConnection(connections, first, l.id))
    : [];
  const second = secondId && partners.some((l) => l.id === secondId) ? secondId : undefined;

  function connect() {
    if (!first || !second) return;
    demoActions.connectLocations(first, second);
    setSecondId(undefined);
  }

  // Alphabetical by origin, then destination, so the list is stable.
  const rows = connections
    .map((c) => {
      const x = locationById.get(c.fromId);
      const y = locationById.get(c.toId);
      if (!x || !y) return null;
      return { connection: c, x, y };
    })
    .filter((r) => r !== null)
    .sort((r, s) => r.x.name.localeCompare(s.x.name) || r.y.name.localeCompare(s.y.name));

  return (
    <section aria-labelledby="connections-heading" className="space-y-4">
      <h2 id="connections-heading">
        <SectionLabel index="04" aside={String(connections.length).padStart(2, "0")}>
          Connections
        </SectionLabel>
      </h2>
      <p className="text-sm opacity-80">
        A connection points from one place to another, e.g. factory → warehouse. It shows direction
        only, not distance.
      </p>

      {locations.length < 2 ? (
        <p className="border-y border-foreground/30 py-4 text-sm opacity-80">
          Add at least two locations to connect them.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <Select
              label="From"
              value={first}
              placeholder="Location"
              onChange={(id) => {
                setFirstId(id);
                if (id === second) setSecondId(undefined);
              }}
              options={locations.map(option)}
            />
            <span aria-hidden className="pb-2.5 font-mono text-xs">
              →
            </span>
            <Select
              label="To"
              value={second}
              placeholder={first && partners.length === 0 ? "All linked" : "Location"}
              disabled={!first || partners.length === 0}
              onChange={setSecondId}
              options={partners.map(option)}
            />
          </div>
          <Button className="w-full justify-between" disabled={!first || !second} onClick={connect}>
            Add connection <span aria-hidden>↘</span>
          </Button>
          <p className="font-mono text-[11px] uppercase tracking-wider opacity-60">
            Tip: select a square on the map, press Connect, then click destinations.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
          {rows.map(({ connection, x, y }) => {
            const selected = connection.id === selectedConnectionId;
            return (
              <li key={connection.id} className="flex items-center gap-3">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectConnection(selected ? null : connection.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 py-3 text-left text-sm",
                    selected && "font-semibold",
                    focusRing,
                  )}
                >
                  <Endpoint location={x} color={colorOf(x)} />
                  <span aria-hidden className="shrink-0 font-mono text-xs">
                    →
                  </span>
                  <span className="sr-only">to</span>
                  <Endpoint location={y} color={colorOf(y)} />
                </button>
                <Button
                  variant="ghost"
                  className="shrink-0 font-mono text-[11px] uppercase tracking-wider"
                  aria-label={`Remove connection from ${x.name} to ${y.name}`}
                  onClick={() => {
                    demoActions.removeConnection(connection.id);
                    if (selected) onSelectConnection(null);
                  }}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Endpoint({ location, color }: { location: Location; color: string | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {color && <Swatch color={color} />}
      <span className="truncate">{location.name}</span>
    </span>
  );
}
