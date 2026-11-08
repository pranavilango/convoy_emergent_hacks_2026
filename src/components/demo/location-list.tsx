"use client";

import { useState, type ReactNode } from "react";

import { distanceKm, formatDistance } from "@/lib/demo/geometry";
import { connectionsOf, degrees, findConnection, incoming, outgoing } from "@/lib/demo/graph";
import { cloneHours, hoursError, summarizeHours, type WeeklyHours } from "@/lib/demo/hours";
import {
  KIND_INFO,
  kindLabel,
  SUPPLIED_BY,
  SUPPLIES,
  type LocationKind,
  type PortMode,
} from "@/lib/demo/kinds";
import { formatPopulation, parsePopulation, populationError } from "@/lib/demo/population";
import { connectionsBrokenByKind, MAX_LOCATION_NAME_LENGTH } from "@/lib/demo/reducer";
import { demoActions } from "@/lib/demo/store";
import type { Connection, Location } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import {
  Button,
  FieldLabel,
  focusRing,
  SectionLabel,
  Segmented,
  Swatch,
  TextInput,
} from "./controls";
import { HoursEditor } from "./hours-editor";
import { KIND_OPTIONS, PORT_MODE_OPTIONS } from "./location-kinds";
import { PopulationInput } from "./population-input";
import { Select } from "./select";

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

export function LocationList({
  locations,
  connections,
  selectedId,
  onSelect,
  onStartConnecting,
}: {
  locations: Location[];
  connections: Connection[];
  selectedId: string | null;
  /** Select a location and move the map to it (null clears the selection). */
  onSelect: (id: string | null) => void;
  /** Enter "click squares on the map to connect" mode. Omitted when the map isn't available. */
  onStartConnecting?: (id: string) => void;
}) {
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
          No locations yet. Search for a port, warehouse, or clinic above and it will appear on the
          map.
        </p>
      ) : (
        <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
          {ordered.map((location) => {
            const selected = location.id === selectedId;
            const degree = degreeById.get(location.id) ?? 0;
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
                  <Swatch color={KIND_INFO[location.kind].color} className="translate-y-[1px]" />
                  <span className="min-w-0">
                    <span className="block truncate text-lg leading-tight tracking-tight">
                      {location.name}
                    </span>
                    <span className="block truncate text-xs opacity-70">{location.address}</span>
                  </span>
                  <span className="text-right font-mono text-[11px] uppercase tracking-wider opacity-70">
                    {kindLabel(location)}
                    {degree > 0 && (
                      <span className="block normal-case" aria-label={plural(degree, "connection")}>
                        —{degree}
                      </span>
                    )}
                  </span>
                </button>
                {selected && (
                  <LocationEditor
                    key={location.id}
                    location={location}
                    locations={locations}
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
  connections,
  onRemoved,
  onStartConnecting,
}: {
  location: Location;
  locations: Location[];
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
      <KindField location={location} locations={locations} connections={connections} />
      {location.kind === "port" && (
        <div className="space-y-2">
          <span className="block font-mono text-[11px] uppercase tracking-wider opacity-70">
            Port
          </span>
          <Segmented
            label="Port"
            value={location.portMode ?? "sea"}
            options={PORT_MODE_OPTIONS}
            onChange={(mode: PortMode) => demoActions.setPortMode(location.id, mode)}
          />
        </div>
      )}
      {location.kind === "clinic" && <ClinicPopulation location={location} />}
      <LocationHours location={location} />
      <LocationConnections
        location={location}
        locations={locations}
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
          ? `Remove location + ${plural(own.length, "connection")}`
          : "Remove location"}
      </Button>
    </div>
  );
}

/** Saved on blur or Enter; Escape puts the saved value back. */
function ClinicPopulation({ location }: { location: Location }) {
  const saved = location.population === null ? "" : formatPopulation(location.population);
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // Follow the saved population if it changes underneath us (e.g. in another tab).
  const [shown, setShown] = useState(location.population);
  if (location.population !== shown) {
    setShown(location.population);
    setText(saved);
    setError(null);
  }

  function commit() {
    if (text.trim() === saved) {
      setError(null);
      return;
    }
    const problem = populationError(text);
    const value = parsePopulation(text);
    if (problem || value === null) {
      setError(problem);
      return;
    }
    setError(null);
    demoActions.setPopulation(location.id, value);
    setText(formatPopulation(value));
  }

  return (
    <div className="space-y-1">
      <PopulationInput
        id={`location-population-${location.id}`}
        value={text}
        onChange={(v) => {
          setText(v);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setText(saved);
            setError(null);
          }
        }}
        error={error}
      />
      {location.population === null && !error && (
        <p className="text-xs font-semibold">Not set yet. Planning needs it.</p>
      )}
    </div>
  );
}

/** Type select. A change that would break existing supply links asks first. */
function KindField({
  location,
  locations,
  connections,
}: {
  location: Location;
  locations: Location[];
  connections: Connection[];
}) {
  const [pending, setPending] = useState<{ kind: LocationKind; count: number } | null>(null);

  function choose(kind: LocationKind) {
    if (kind === location.kind) {
      setPending(null);
      return;
    }
    const count = connectionsBrokenByKind({ locations, connections }, location.id, kind).length;
    if (count === 0) {
      demoActions.setLocationKind(location.id, kind);
      setPending(null);
    } else {
      setPending({ kind, count });
    }
  }

  return (
    <div className="space-y-2">
      <Select
        label="Type"
        value={location.kind}
        onChange={(v) => choose(v as LocationKind)}
        options={KIND_OPTIONS}
      />
      {pending && (
        <div role="alert" className="space-y-2 rounded-sm border border-foreground/40 p-3">
          <p className="text-sm">
            A {KIND_INFO[pending.kind].label.toLowerCase()} can&apos;t keep{" "}
            {pending.count === 1 ? "this connection" : `these ${pending.count} connections`}:
            supplies only flow port → warehouse → clinic. Change the type and remove{" "}
            {pending.count === 1 ? "it" : "them"}?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                demoActions.setLocationKind(location.id, pending.kind);
                setPending(null);
              }}
            >
              Change + remove {plural(pending.count, "connection")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LocationConnections({
  location,
  locations,
  connections,
  onStartConnecting,
}: {
  location: Location;
  locations: Location[];
  connections: Connection[];
  onStartConnecting?: (id: string) => void;
}) {
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const rows = (list: Connection[], end: (c: Connection) => string) =>
    list
      .map((c) => ({ connection: c, other: locationById.get(end(c)) }))
      .filter((r): r is { connection: Connection; other: Location } => r.other !== undefined)
      .sort((r, s) => r.other.name.localeCompare(s.other.name));

  const downstream = SUPPLIES[location.kind];
  const upstream = SUPPLIED_BY[location.kind];
  const ofKind = (kind: LocationKind | null) =>
    kind ? locations.filter((l) => l.kind === kind) : [];
  // Sites of the right kind that aren't linked yet, in each direction.
  const supplyCandidates = ofKind(downstream).filter(
    (l) => !findConnection(connections, location.id, l.id),
  );
  const supplierCandidates = ofKind(upstream).filter(
    (l) => !findConnection(connections, l.id, location.id),
  );
  const option = (l: Location) => ({
    value: l.id,
    label: `${l.name} · ${formatDistance(distanceKm(location, l))}`,
    color: KIND_INFO[l.kind].color,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">
          Connections
        </span>
        {onStartConnecting && supplyCandidates.length > 0 && (
          <Button
            variant="ghost"
            className="font-mono text-[11px] uppercase tracking-wider"
            onClick={() => onStartConnecting(location.id)}
          >
            Connect on map ↘
          </Button>
        )}
      </div>

      {upstream && (
        <ConnectionGroup
          label="Supplied by"
          arrow="←"
          origin={location}
          rows={rows(incoming(connections, location.id), (c) => c.fromId)}
          removeLabel={(other) => `Remove supply from ${other.name}`}
          empty={
            ofKind(upstream).length === 0
              ? `No ${KIND_INFO[upstream].plural.toLowerCase()} on the map yet.`
              : "None yet."
          }
        >
          {supplierCandidates.length > 0 && (
            <Select
              label={`${location.name} is supplied by`}
              hideLabel
              compact
              value={undefined}
              placeholder={`+ Add a supplying ${KIND_INFO[upstream].label.toLowerCase()}…`}
              onChange={(id) => demoActions.connectLocations(id, location.id)}
              options={supplierCandidates.map(option)}
            />
          )}
        </ConnectionGroup>
      )}

      {downstream && (
        <ConnectionGroup
          label="Supplies"
          arrow="→"
          origin={location}
          rows={rows(outgoing(connections, location.id), (c) => c.toId)}
          removeLabel={(other) => `Remove supply to ${other.name}`}
          empty={
            ofKind(downstream).length === 0
              ? `No ${KIND_INFO[downstream].plural.toLowerCase()} on the map yet.`
              : "None yet."
          }
        >
          {supplyCandidates.length > 0 && (
            <Select
              label={`${location.name} supplies`}
              hideLabel
              compact
              value={undefined}
              placeholder={`+ Add a ${KIND_INFO[downstream].label.toLowerCase()} it supplies…`}
              onChange={(id) => demoActions.connectLocations(location.id, id)}
              options={supplyCandidates.map(option)}
            />
          )}
        </ConnectionGroup>
      )}
    </div>
  );
}

function ConnectionGroup({
  label,
  arrow,
  origin,
  rows,
  removeLabel,
  empty,
  children,
}: {
  label: string;
  arrow: string;
  origin: Location;
  rows: { connection: Connection; other: Location }[];
  removeLabel: (other: Location) => string;
  empty: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <span className="block font-mono text-[11px] uppercase tracking-wider opacity-70">
        {label} <span aria-hidden>{arrow}</span>
      </span>
      {rows.length === 0 ? (
        <p className="text-sm opacity-60">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map(({ connection, other }) => (
            <li
              key={connection.id}
              className="flex items-center gap-1.5 rounded-sm border border-foreground py-0.5 pl-2 pr-1 text-sm"
            >
              <Swatch color={KIND_INFO[other.kind].color} />
              <span className="max-w-32 truncate">{other.name}</span>
              <span className="font-mono text-[11px] opacity-70">
                {formatDistance(distanceKm(origin, other))}
              </span>
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
      {children}
    </div>
  );
}

function LocationHours({ location }: { location: Location }) {
  const [draft, setDraft] = useState<WeeklyHours | null>(null);
  const problem = draft ? hoursError(draft) : null;

  if (location.kind === "port") {
    return (
      <div className="space-y-1.5">
        <span className="block font-mono text-[11px] uppercase tracking-wider opacity-70">
          Working hours
        </span>
        <p className="text-sm">Open 24/7. Ports never close.</p>
      </div>
    );
  }

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
          onClick={() => setDraft(cloneHours(location.hours))}
        >
          Edit
        </Button>
      </div>
      <ul className="space-y-0.5 text-sm">
        {summarizeHours(location.hours).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
