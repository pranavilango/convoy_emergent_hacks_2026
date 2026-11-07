"use client";

import { useState } from "react";

import { connectionsOf, degrees, findConnection, incoming, outgoing } from "@/lib/demo/graph";
import {
  cloneHours,
  DEFAULT_HOURS,
  hoursError,
  summarizeHours,
  type WeeklyHours,
} from "@/lib/demo/hours";
import { MAX_LOCATION_NAME_LENGTH } from "@/lib/demo/reducer";
import { demoActions } from "@/lib/demo/store";
import type { Connection, Location, LocationType } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import { Button, FieldLabel, focusRing, SectionLabel, Swatch, TextInput } from "./controls";
import { HoursEditor } from "./hours-editor";
import { Select } from "./select";

export function LocationList({
  locations,
  types,
  connections,
  selectedId,
  onSelect,
  onStartConnecting,
}: {
  locations: Location[];
  types: LocationType[];
  connections: Connection[];
  selectedId: string | null;
  /** Select a location and move the map to it (null clears the selection). */
  onSelect: (id: string | null) => void;
  /** Enter "click squares on the map to connect" mode. Omitted when the map isn't available. */
  onStartConnecting?: (id: string) => void;
}) {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const degreeById = degrees(connections);
  // Newest first: the one you just added is the one you're most likely to look at.
  const ordered = [...locations].reverse();

  return (
    <section aria-labelledby="locations-heading" className="space-y-4">
      <h2 id="locations-heading">
        <SectionLabel index="03" aside={String(locations.length).padStart(2, "0")}>
          Locations
        </SectionLabel>
      </h2>

      {locations.length === 0 ? (
        <p className="border-y border-foreground/30 py-4 text-sm opacity-80">
          No locations yet. Search for an address above and it will appear on the map.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
          {ordered.map((location) => {
            const type = typeById.get(location.typeId);
            if (!type) return null;
            const selected = location.id === selectedId;
            return (
              <li key={location.id}>
                <button
                  type="button"
                  aria-expanded={selected}
                  onClick={() => onSelect(selected ? null : location.id)}
                  className={cn(
                    "grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-3 text-left",
                    focusRing,
                  )}
                >
                  <Swatch color={type.color} className="translate-y-[1px]" />
                  <span className="min-w-0">
                    <span className="block truncate text-lg leading-tight tracking-tight">
                      {location.name}
                    </span>
                    <span className="block truncate text-xs opacity-70">{location.address}</span>
                  </span>
                  <span className="text-right font-mono text-[11px] uppercase tracking-wider opacity-70">
                    {type.name}
                    {(degreeById.get(location.id) ?? 0) > 0 && (
                      <span
                        className="block normal-case"
                        aria-label={`${degreeById.get(location.id)} connections`}
                      >
                        —{degreeById.get(location.id)}
                      </span>
                    )}
                  </span>
                </button>
                {selected && (
                  <LocationEditor
                    key={location.id}
                    location={location}
                    locations={locations}
                    types={types}
                    connections={connections}
                    onRemoved={() => onSelect(null)}
                    {...(onStartConnecting ? { onStartConnecting } : {})}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LocationEditor({
  location,
  locations,
  types,
  connections,
  onRemoved,
  onStartConnecting,
}: {
  location: Location;
  locations: Location[];
  types: LocationType[];
  connections: Connection[];
  onRemoved: () => void;
  onStartConnecting?: (id: string) => void;
}) {
  const own = connectionsOf(connections, location.id);
  const [name, setName] = useState(location.name);
  const inputId = `location-name-${location.id}`;

  function commitName() {
    if (name.trim() && name !== location.name) demoActions.renameLocation(location.id, name);
    else setName(location.name);
  }

  return (
    <div className="space-y-4 pb-5 pl-6">
      <div>
        <FieldLabel htmlFor={inputId}>Name</FieldLabel>
        <TextInput
          id={inputId}
          value={name}
          maxLength={MAX_LOCATION_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitName();
            } else if (e.key === "Escape") {
              setName(location.name);
            }
          }}
        />
      </div>
      <Select
        label="Type"
        value={location.typeId}
        onChange={(typeId) => demoActions.setLocationType(location.id, typeId)}
        options={types.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
      />
      <LocationHours location={location} />
      <LocationConnections
        location={location}
        locations={locations}
        types={types}
        connections={connections}
        {...(onStartConnecting ? { onStartConnecting } : {})}
      />
      <Button
        variant="ghost"
        className="font-mono text-[11px] uppercase tracking-wider"
        onClick={() => {
          demoActions.removeLocation(location.id);
          onRemoved();
        }}
      >
        {own.length > 0
          ? `Remove location + ${own.length} ${own.length === 1 ? "connection" : "connections"}`
          : "Remove location"}
      </Button>
    </div>
  );
}

function LocationConnections({
  location,
  locations,
  types,
  connections,
  onStartConnecting,
}: {
  location: Location;
  locations: Location[];
  types: LocationType[];
  connections: Connection[];
  onStartConnecting?: (id: string) => void;
}) {
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const colorOf = (l: Location) => types.find((t) => t.id === l.typeId)?.color;
  const rows = (list: Connection[], end: (c: Connection) => string) =>
    list
      .map((c) => ({ connection: c, other: locationById.get(end(c)) }))
      .filter((r): r is { connection: Connection; other: Location } => r.other !== undefined)
      .sort((r, s) => r.other.name.localeCompare(s.other.name));
  const outRows = rows(outgoing(connections, location.id), (c) => c.toId);
  const inRows = rows(incoming(connections, location.id), (c) => c.fromId);
  // Destinations this location doesn't point to yet.
  const candidates = locations.filter(
    (l) => l.id !== location.id && !findConnection(connections, location.id, l.id),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">
          Connections
        </span>
        {onStartConnecting && candidates.length > 0 && (
          <Button
            variant="ghost"
            className="font-mono text-[11px] uppercase tracking-wider"
            onClick={() => onStartConnecting(location.id)}
          >
            Connect on map ↘
          </Button>
        )}
      </div>
      <ConnectionChips
        label="To"
        arrow="→"
        rows={outRows}
        colorOf={colorOf}
        removeLabel={(other) => `Remove connection to ${other.name}`}
      />
      <ConnectionChips
        label="From"
        arrow="←"
        rows={inRows}
        colorOf={colorOf}
        removeLabel={(other) => `Remove connection from ${other.name}`}
      />
      {candidates.length > 0 && (
        <Select
          label={`Connect ${location.name} to`}
          hideLabel
          value={undefined}
          placeholder="+ Connect to…"
          onChange={(id) => demoActions.connectLocations(location.id, id)}
          options={candidates.map((l) => ({
            value: l.id,
            label: l.name,
            ...(colorOf(l) ? { color: colorOf(l)! } : {}),
          }))}
        />
      )}
    </div>
  );
}

function ConnectionChips({
  label,
  arrow,
  rows,
  colorOf,
  removeLabel,
}: {
  label: string;
  arrow: string;
  rows: { connection: Connection; other: Location }[];
  colorOf: (l: Location) => string | undefined;
  removeLabel: (other: Location) => string;
}) {
  return (
    <div className="grid grid-cols-[3rem_1fr] items-start gap-2">
      <span className="pt-1 font-mono text-[11px] uppercase tracking-wider opacity-70">
        {label} <span aria-hidden>{arrow}</span>
      </span>
      {rows.length === 0 ? (
        <span className="pt-0.5 text-sm opacity-60">None</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map(({ connection, other }) => (
            <li
              key={connection.id}
              className="flex items-center gap-1.5 rounded-sm border border-foreground py-0.5 pl-2 pr-1 text-sm"
            >
              {colorOf(other) && <Swatch color={colorOf(other)!} />}
              <span className="max-w-32 truncate">{other.name}</span>
              <button
                type="button"
                aria-label={removeLabel(other)}
                onClick={() => demoActions.removeConnection(connection.id)}
                className={cn(
                  "rounded-sm px-1 font-mono text-xs hover:bg-foreground hover:text-background",
                  focusRing,
                )}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocationHours({ location }: { location: Location }) {
  const [draft, setDraft] = useState<WeeklyHours | null>(null);
  const problem = draft ? hoursError(draft) : null;

  if (draft) {
    return (
      <fieldset className="space-y-3">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-wider opacity-70">
          Working hours
        </legend>
        <HoursEditor value={draft} onChange={setDraft} />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!!problem}
            onClick={() => {
              demoActions.setLocationHours(location.id, draft);
              setDraft(null);
            }}
          >
            Save hours
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </fieldset>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">
          Working hours
        </span>
        <Button
          variant="ghost"
          className="font-mono text-[11px] uppercase tracking-wider"
          onClick={() => setDraft(cloneHours(location.hours ?? DEFAULT_HOURS))}
        >
          {location.hours ? "Edit" : "Add hours"}
        </Button>
      </div>
      {location.hours ? (
        <ul className="space-y-0.5 text-sm">
          {summarizeHours(location.hours).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm opacity-70">Not set yet.</p>
      )}
    </div>
  );
}
