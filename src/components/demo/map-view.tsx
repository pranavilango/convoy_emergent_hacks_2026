"use client";

import { AdvancedMarker, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";

import type { Connection, Location, LocationType } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

const DEFAULT_CENTER = { lat: 30, lng: 0 };
const DEFAULT_ZOOM = 2;
const SINGLE_LOCATION_ZOOM = 14;
const FIT_PADDING = { top: 140, right: 60, bottom: 60, left: 60 };

/** Ask the map to move to a location. `nonce` lets the same location be focused twice. */
export type FocusRequest = { id: string; nonce: number };

export function MapView({
  mapId,
  locations,
  connections,
  types,
  selectedId,
  focus,
  onSelect,
}: {
  mapId: string;
  locations: Location[];
  connections: Connection[];
  types: LocationType[];
  selectedId: string | null;
  focus: FocusRequest | null;
  onSelect: (id: string | null) => void;
}) {
  const typeById = new globalThis.Map(types.map((t) => [t.id, t]));
  const locationById = new globalThis.Map(locations.map((location) => [location.id, location]));

  return (
    <Map
      mapId={mapId}
      defaultCenter={DEFAULT_CENTER}
      defaultZoom={DEFAULT_ZOOM}
      gestureHandling="greedy"
      disableDefaultUI
      zoomControl
      clickableIcons={false}
      reuseMaps
      onClick={() => onSelect(null)}
      className="h-full w-full"
    >
      {connections.map((connection) => {
        const from = locationById.get(connection.fromId);
        const to = locationById.get(connection.toId);
        if (!from || !to) return null;
        return (
          <Polyline
            key={connection.id}
            path={[
              { lat: from.lat, lng: from.lng },
              { lat: to.lat, lng: to.lng },
            ]}
            strokeColor="#ce6c54"
            strokeOpacity={0.9}
            strokeWeight={2}
            clickable={false}
            icons={[
              {
                icon: {
                  path: "M 0,-1 0,1 2,0 z",
                  scale: 4,
                  strokeColor: "#ce6c54",
                  fillColor: "#ce6c54",
                  fillOpacity: 1,
                },
                offset: "100%",
              },
            ]}
          />
        );
      })}
      {locations.map((location) => {
        const type = typeById.get(location.typeId);
        if (!type) return null;
        return (
          <LocationMarker
            key={location.id}
            location={location}
            type={type}
            selected={location.id === selectedId}
            onSelect={() => onSelect(location.id)}
          />
        );
      })}
      <CameraController locations={locations} focus={focus} />
    </Map>
  );
}

function LocationMarker({
  location,
  type,
  selected,
  onSelect,
}: {
  location: Location;
  type: LocationType;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <AdvancedMarker
      position={{ lat: location.lat, lng: location.lng }}
      title={`${location.name} (${type.name})`}
      onClick={onSelect}
      zIndex={selected ? 1000 : null}
      className="group"
    >
      <div className="flex flex-col items-center font-display">
        {selected ? (
          <div className="mb-2 w-60 rounded-sm border border-ink-foreground/25 bg-ink p-3 text-left text-ink-foreground shadow-xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider opacity-80">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: type.color }}
              />
              {type.name}
            </div>
            <p className="mt-1.5 text-base leading-tight tracking-tight">{location.name}</p>
            <p className="mt-1 text-xs leading-snug opacity-60">{location.address}</p>
          </div>
        ) : (
          <div className="pointer-events-none mb-1.5 hidden max-w-48 truncate rounded-sm bg-ink px-2 py-1 text-xs text-ink-foreground group-hover:block">
            {location.name}
          </div>
        )}
        <span
          className={cn(
            "block rounded-sm border-2 border-ink shadow-[0_0_0_1px_var(--color-ink-foreground)] transition-transform",
            selected ? "h-5 w-5" : "h-4 w-4 group-hover:scale-110",
          )}
          style={{ backgroundColor: type.color }}
        />
        <span aria-hidden className="block h-2.5 w-px bg-ink-foreground" />
      </div>
    </AdvancedMarker>
  );
}

/**
 * Camera rules:
 * - On first load, and whenever a location is added, fit every location in view.
 * - Removing locations leaves the camera alone.
 * - A focus request (clicking a row in the list) pans to that location.
 */
function CameraController({
  locations,
  focus,
}: {
  locations: Location[];
  focus: FocusRequest | null;
}) {
  const map = useMap();
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!map) return;
    const ids = new Set(locations.map((l) => l.id));
    const previous = knownIds.current;
    knownIds.current = ids;
    const added = previous === null || [...ids].some((id) => !previous.has(id));
    if (!added || locations.length === 0) return;

    const [first] = locations;
    if (locations.length === 1 && first) {
      map.setCenter({ lat: first.lat, lng: first.lng });
      map.setZoom(SINGLE_LOCATION_ZOOM);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const l of locations) bounds.extend({ lat: l.lat, lng: l.lng });
    map.fitBounds(bounds, FIT_PADDING);
  }, [map, locations]);

  useEffect(() => {
    if (!map || !focus) return;
    const target = locations.find((l) => l.id === focus.id);
    if (!target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    if ((map.getZoom() ?? 0) < 12) map.setZoom(SINGLE_LOCATION_ZOOM);
    // Only react to new focus requests, not to every locations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus]);

  return null;
}
