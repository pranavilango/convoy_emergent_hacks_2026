"use client";

import { useState } from "react";

import { MAX_LOCATION_NAME_LENGTH } from "@/lib/demo/reducer";
import { demoActions } from "@/lib/demo/store";
import type { Location, LocationType } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import { Button, FieldLabel, focusRing, SectionLabel, Swatch, TextInput } from "./controls";
import { Select } from "./select";

export function LocationList({
  locations,
  types,
  selectedId,
  onSelect,
}: {
  locations: Location[];
  types: LocationType[];
  selectedId: string | null;
  /** Select a location and move the map to it (null clears the selection). */
  onSelect: (id: string | null) => void;
}) {
  const typeById = new Map(types.map((t) => [t.id, t]));
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
                  <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">
                    {type.name}
                  </span>
                </button>
                {selected && (
                  <LocationEditor
                    key={location.id}
                    location={location}
                    types={types}
                    onRemoved={() => onSelect(null)}
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
  types,
  onRemoved,
}: {
  location: Location;
  types: LocationType[];
  onRemoved: () => void;
}) {
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
      <Button
        variant="ghost"
        className="font-mono text-[11px] uppercase tracking-wider"
        onClick={() => {
          demoActions.removeLocation(location.id);
          onRemoved();
        }}
      >
        Remove location
      </Button>
    </div>
  );
}
