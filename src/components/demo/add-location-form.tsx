"use client";

import { useState, type FormEvent } from "react";

import {
  ALWAYS_OPEN,
  cloneHours,
  DEFAULT_HOURS,
  hoursError,
  type WeeklyHours,
} from "@/lib/demo/hours";
import type { LocationKind, PortMode } from "@/lib/demo/kinds";
import { parsePopulation, populationError } from "@/lib/demo/population";
import { MAX_LOCATION_NAME_LENGTH } from "@/lib/demo/reducer";
import { demoActions } from "@/lib/demo/store";

import { Button, FieldLabel, SectionLabel, Segmented, TextInput } from "./controls";
import { HoursEditor } from "./hours-editor";
import { KIND_OPTIONS, PORT_MODE_OPTIONS } from "./location-kinds";
import { PopulationInput } from "./population-input";
import { PlaceSearch, type PickedPlace } from "./place-search";
import { Select } from "./select";

export function AddLocationForm({
  searchAvailable,
  onAdded,
}: {
  /** False when Google Maps isn't configured or failed to load. */
  searchAvailable: boolean;
  onAdded: (id: string) => void;
}) {
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [name, setName] = useState("");
  // Kind, port mode, and hours are kept between additions: people tend to add several clinics
  // in a row, and sites of one kind often share hours.
  const [kind, setKind] = useState<LocationKind>("port");
  const [portMode, setPortMode] = useState<PortMode>("sea");
  const [hours, setHours] = useState<WeeklyHours>(() => cloneHours(DEFAULT_HOURS));
  // Population is per clinic, so it's cleared after each addition.
  const [populationText, setPopulationText] = useState("");
  const [showPopulationError, setShowPopulationError] = useState(false);
  const isPort = kind === "port";
  const isClinic = kind === "clinic";
  const hoursProblem = isPort ? null : hoursError(hours);
  const populationProblem = isClinic ? populationError(populationText) : null;

  function onPick(place: PickedPlace) {
    setPicked(place);
    setName(place.name);
  }

  function reset() {
    setPicked(null);
    setName("");
    setPopulationText("");
    setShowPopulationError(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked || hoursProblem) return;
    if (populationProblem) {
      setShowPopulationError(true);
      return;
    }
    const id = demoActions.addLocation({
      name: name.trim() || picked.name,
      address: picked.address,
      placeId: picked.placeId,
      lat: picked.lat,
      lng: picked.lng,
      kind,
      portMode: isPort ? portMode : null,
      hours: isPort ? ALWAYS_OPEN : hours,
      population: isClinic ? parsePopulation(populationText) : null,
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

          <Select
            label="Type"
            value={kind}
            onChange={(v) => setKind(v as LocationKind)}
            options={KIND_OPTIONS}
          />

          {isClinic && (
            <PopulationInput
              id="location-population"
              value={populationText}
              onChange={setPopulationText}
              onBlur={() => setShowPopulationError(populationText.trim() !== "")}
              error={showPopulationError ? populationProblem : null}
            />
          )}

          {isPort ? (
            <div className="space-y-2">
              <span className="block font-mono text-[11px] uppercase tracking-wider opacity-70">
                Port
              </span>
              <Segmented
                label="Port"
                value={portMode}
                options={PORT_MODE_OPTIONS}
                onChange={setPortMode}
              />
              <p className="text-sm opacity-80">
                Ports are open 24/7, so they have no hours to set.
              </p>
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 font-mono text-[11px] uppercase tracking-wider opacity-70">
                Working hours
              </legend>
              <HoursEditor value={hours} onChange={setHours} />
            </fieldset>
          )}

          <Button type="submit" className="w-full justify-between" disabled={!!hoursProblem}>
            Add to map <span aria-hidden>↘</span>
          </Button>
        </form>
      )}
    </section>
  );
}
