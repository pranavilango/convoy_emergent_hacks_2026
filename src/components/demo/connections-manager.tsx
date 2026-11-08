"use client";

import { useState } from "react";

import { distanceKm, formatDistance } from "@/lib/demo/geometry";
import { findConnection } from "@/lib/demo/graph";
import { canSupply, KIND_INFO } from "@/lib/demo/kinds";
import { demoActions } from "@/lib/demo/store";
import type { Connection, Location } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import { Button, focusRing, SectionLabel, Swatch } from "./controls";
import { Select } from "./select";

export function ConnectionsManager({
  locations,
  connections,
  selectedConnectionId,
  onSelectConnection,
}: {
  locations: Location[];
  connections: Connection[];
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
}) {
  const [firstId, setFirstId] = useState<string | undefined>(undefined);
  const [secondId, setSecondId] = useState<string | undefined>(undefined);

  const locationById = new Map(locations.map((l) => [l.id, l]));
  const option = (l: Location, from?: Location) => ({
    value: l.id,
    label: from ? `${l.name} · ${formatDistance(distanceKm(from, l))}` : l.name,
    color: KIND_INFO[l.kind].color,
  });

  // Anything that can supply something: ports and warehouses with a site of the next kind.
  const suppliers = locations.filter((s) => locations.some((t) => canSupply(s.kind, t.kind)));
  const first = firstId ? suppliers.find((l) => l.id === firstId) : undefined;
  // Only offer sites of the next kind that this one doesn't already supply.
  const partners = first
    ? locations.filter(
        (l) => canSupply(first.kind, l.kind) && !findConnection(connections, first.id, l.id),
      )
    : [];
  const second = secondId && partners.some((l) => l.id === secondId) ? secondId : undefined;

  function connect() {
    if (!first || !second) return;
    demoActions.connectLocations(first.id, second);
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
        Supplies flow one way: port → warehouse → clinic. Distances are straight lines between
        sites.
      </p>

      {suppliers.length === 0 ? (
        <p className="border-y border-foreground/30 py-4 text-sm opacity-80">
          Add a port and a warehouse, or a warehouse and a clinic, to connect them.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <Select
              label="From"
              value={first?.id}
              placeholder="Port or warehouse"
              onChange={(id) => {
                setFirstId(id);
                setSecondId(undefined);
              }}
              options={suppliers.map((l) => option(l))}
            />
            <span aria-hidden className="pb-2.5 font-mono text-xs">
              →
            </span>
            <Select
              label="To"
              value={second}
              placeholder={
                !first
                  ? "Location"
                  : partners.length === 0
                    ? "All linked"
                    : first.kind === "port"
                      ? "Warehouse"
                      : "Clinic"
              }
              disabled={!first || partners.length === 0}
              onChange={setSecondId}
              options={first ? partners.map((l) => option(l, first)) : []}
            />
          </div>
          <Button className="w-full justify-between" disabled={!first || !second} onClick={connect}>
            Add connection <span aria-hidden>↘</span>
          </Button>
          <p className="font-mono text-[11px] uppercase tracking-wider opacity-60">
            Tip: select a port or warehouse on the map, press Connect, then click destinations.
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
                  <Endpoint location={x} />
                  <span aria-hidden className="shrink-0 font-mono text-xs">
                    →
                  </span>
                  <span className="sr-only">to</span>
                  <Endpoint location={y} />
                  <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] opacity-70">
                    {formatDistance(distanceKm(x, y))}
                  </span>
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

function Endpoint({ location }: { location: Location }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Swatch color={KIND_INFO[location.kind].color} />
      <span className="truncate">{location.name}</span>
    </span>
  );
}
