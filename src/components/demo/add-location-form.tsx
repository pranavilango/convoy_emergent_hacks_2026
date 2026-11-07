"use client";

import { useState, type FormEvent } from "react";

import { MAX_LOCATION_NAME_LENGTH } from "@/lib/demo/reducer";
import { demoActions } from "@/lib/demo/store";
import type { LocationType } from "@/lib/demo/types";

import { Button, FieldLabel, SectionLabel, TextInput } from "./controls";
import { PlaceSearch, type PickedPlace } from "./place-search";
import { Select } from "./select";

export function AddLocationForm({
  types,
  searchAvailable,
  onAdded,
}: {
  types: LocationType[];
  /** False when Google Maps isn't configured or failed to load. */
  searchAvailable: boolean;
  onAdded: (id: string) => void;
}) {
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [name, setName] = useState("");
  // Remember the last type used: people tend to add several of the same kind in a row.
  const [chosenTypeId, setChosenTypeId] = useState<string | undefined>(undefined);
  const typeId = types.some((t) => t.id === chosenTypeId) ? chosenTypeId : types[0]?.id;

  function onPick(place: PickedPlace) {
    setPicked(place);
    setName(place.name);
  }

  function reset() {
    setPicked(null);
    setName("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked || !typeId) return;
    const id = demoActions.addLocation({
      name: name.trim() || picked.name,
      address: picked.address,
      placeId: picked.placeId,
      lat: picked.lat,
      lng: picked.lng,
      typeId,
    });
    reset();
    onAdded(id);
  }

  return (
    <section aria-labelledby="add-heading" className="space-y-5">
      <h2 id="add-heading">
        <SectionLabel index="01">Add a location</SectionLabel>
      </h2>

      {!searchAvailable ? (
        <p className="text-sm opacity-80">
          Address search needs Google Maps. See the note on the map for how to set it up.
        </p>
      ) : !picked ? (
        <PlaceSearch onPick={onPick} />
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="rounded-sm border border-foreground/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-wider opacity-70">
                  Selected address
                </div>
                <p className="mt-1 text-sm leading-snug">{picked.address}</p>
              </div>
              <Button
                variant="ghost"
                className="shrink-0 font-mono text-[11px] uppercase tracking-wider"
                onClick={reset}
              >
                Change
              </Button>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="location-name">Name</FieldLabel>
            <TextInput
              id="location-name"
              value={name}
              maxLength={MAX_LOCATION_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder={picked.name}
            />
          </div>

          {types.length > 0 ? (
            <Select
              label="Type"
              value={typeId}
              onChange={setChosenTypeId}
              options={types.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
            />
          ) : (
            <p className="text-sm">Create a location type below first.</p>
          )}

          <Button type="submit" className="w-full justify-between" disabled={!typeId}>
            Add to map <span aria-hidden>↘</span>
          </Button>
        </form>
      )}
    </section>
  );
}
