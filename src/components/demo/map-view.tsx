"use client";

import { AdvancedMarker, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { pointBeforeEnd, visualMidpoint } from "@/lib/demo/geometry";
import { degrees, findConnection, involves } from "@/lib/demo/graph";
import { summarizeHours } from "@/lib/demo/hours";
import type { Connection, Location, LocationType } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import type { Selection } from "./selection";

const DEFAULT_CENTER = { lat: 30, lng: 0 };
const DEFAULT_ZOOM = 2;
const SINGLE_LOCATION_ZOOM = 14;
const FIT_PADDING = { top: 160, right: 60, bottom: 60, left: 60 };

/** Connection lines use the same ink as the squares' borders. */
const LINE_INK = "#050a0f";
/** Distance from the destination's centre to the arrow tip: half a square (8–10px) plus its
 *  outline and a hair of space, so the arrowhead sits just outside the square's edge. */
const ARROW_GAP_PX = 13;
/** Open chevron like the site's → glyph. Symbol "up" (−y) points along the line, tip at 0,0. */
const ARROW_PATH = "M -1,1.6 0,0 1,1.6";

/** Ask the map to frame some locations. `nonce` lets the same request be repeated. */
export type FocusRequest = { ids: string[]; nonce: number };

export function MapView({
  mapId,
  locations,
  connections,
  types,
  selection,
  connectingFrom,
  focus,
  onSelect,
  onConnectTo,
  onStartConnecting,
  onRemoveConnection,
  onBackgroundClick,
}: {
  mapId: string;
  locations: Location[];
  connections: Connection[];
  types: LocationType[];
  selection: Selection;
  /** When set, clicking another location connects (or disconnects) it from this one. */
  connectingFrom: string | null;
  focus: FocusRequest | null;
  onSelect: (selection: Selection) => void;
  onConnectTo: (locationId: string) => void;
  onStartConnecting: (locationId: string) => void;
  onRemoveConnection: (connectionId: string) => void;
  onBackgroundClick: () => void;
}) {
  const typeById = new globalThis.Map(types.map((t) => [t.id, t]));
  const locationById = new globalThis.Map(locations.map((l) => [l.id, l]));
  const degreeById = degrees(connections);

  // The location whose links are emphasised: the one being connected from, else the selected one.
  const focusLocationId = connectingFrom ?? (selection?.kind === "location" ? selection.id : null);
  const selectedConnectionId = selection?.kind === "connection" ? selection.id : null;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const selectedLocation =
    selection?.kind === "location" && !connectingFrom ? locationById.get(selection.id) : undefined;
  const selectedConnection = selectedConnectionId
    ? connections.find((c) => c.id === selectedConnectionId)
    : undefined;

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
      onClick={onBackgroundClick}
      // Lines are trimmed in screen pixels, so they need the current zoom.
      onZoomChanged={(e) => setZoom(e.detail.zoom)}
      onIdle={(e) => setZoom(e.map.getZoom() ?? DEFAULT_ZOOM)}
      className="h-full w-full"
    >
      {connections.map((connection) => {
        const from = locationById.get(connection.fromId);
        const to = locationById.get(connection.toId);
        if (!from || !to) return null;
        const emphasis: LineEmphasis =
          selectedConnectionId === connection.id ||
          (focusLocationId !== null && involves(connection, focusLocationId))
            ? "strong"
            : selectedConnectionId !== null || focusLocationId !== null
              ? "dim"
              : "normal";
        return (
          <ConnectionLine
            key={connection.id}
            from={from}
            to={to}
            zoom={zoom}
            emphasis={emphasis}
            interactive={!connectingFrom}
            onClick={() => onSelect({ kind: "connection", id: connection.id })}
          />
        );
      })}

      {connectingFrom && locationById.get(connectingFrom) && (
        <DraftLine origin={locationById.get(connectingFrom)!} />
      )}

      {locations.map((location) => {
        const type = typeById.get(location.typeId);
        if (!type) return null;
        const isOrigin = location.id === connectingFrom;
        return (
          <LocationSquare
            key={location.id}
            location={location}
            type={type}
            state={
              isOrigin || location.id === focusLocationId
                ? "active"
                : connectingFrom && findConnection(connections, connectingFrom, location.id)
                  ? "linked"
                  : connectingFrom
                    ? "candidate"
                    : "idle"
            }
            onClick={() => {
              if (connectingFrom) {
                if (!isOrigin) onConnectTo(location.id);
              } else {
                onSelect({ kind: "location", id: location.id });
              }
            }}
          />
        );
      })}

      {selectedLocation && typeById.get(selectedLocation.typeId) && (
        <MapCard position={selectedLocation} gap={14}>
          <CardLabel color={typeById.get(selectedLocation.typeId)!.color}>
            {typeById.get(selectedLocation.typeId)!.name}
          </CardLabel>
          <p className="mt-1.5 text-base leading-tight tracking-tight">{selectedLocation.name}</p>
          <p className="mt-1 text-xs leading-snug opacity-60">{selectedLocation.address}</p>
          <ul className="mt-2.5 space-y-0.5 font-mono text-[10px] uppercase tracking-wider opacity-80">
            {selectedLocation.hours ? (
              summarizeHours(selectedLocation.hours).map((line) => <li key={line}>{line}</li>)
            ) : (
              <li className="opacity-70">Hours not set</li>
            )}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-ink-foreground/15 pt-2.5">
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
              {connectionCountLabel(degreeById.get(selectedLocation.id) ?? 0)}
            </span>
            <CardButton onClick={() => onStartConnecting(selectedLocation.id)}>
              Connect ↘
            </CardButton>
          </div>
        </MapCard>
      )}

      {selectedConnection &&
        locationById.get(selectedConnection.fromId) &&
        locationById.get(selectedConnection.toId) && (
          <MapCard
            position={visualMidpoint(
              locationById.get(selectedConnection.fromId)!,
              locationById.get(selectedConnection.toId)!,
            )}
            gap={10}
          >
            <CardLabel>Connection</CardLabel>
            <p className="mt-1.5 text-sm leading-snug">
              {locationById.get(selectedConnection.fromId)!.name}
              <span aria-hidden className="mx-1.5 font-mono opacity-60">
                →
              </span>
              <span className="sr-only"> to </span>
              {locationById.get(selectedConnection.toId)!.name}
            </p>
            <div className="mt-3 flex justify-end border-t border-ink-foreground/15 pt-2.5">
              <CardButton onClick={() => onRemoveConnection(selectedConnection.id)}>
                Remove
              </CardButton>
            </div>
          </MapCard>
        )}

      <CameraController locations={locations} focus={focus} />
    </Map>
  );
}

export function connectionCountLabel(count: number): string {
  return `${String(count).padStart(2, "0")} ${count === 1 ? "connection" : "connections"}`;
}

// --- Locations -----------------------------------------------------------------------------

type SquareState = "idle" | "active" | "linked" | "candidate";

/** A location drawn as a square centred exactly on its coordinates, so connection lines meet
 *  the middle of each square. */
function LocationSquare({
  location,
  type,
  state,
  onClick,
}: {
  location: Location;
  type: LocationType;
  state: SquareState;
  onClick: () => void;
}) {
  return (
    <AdvancedMarker
      position={{ lat: location.lat, lng: location.lng }}
      title={`${location.name} (${type.name})`}
      onClick={onClick}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={state === "active" ? 900 : state === "idle" ? null : 800}
      className="group"
    >
      <div className="relative font-display">
        <span
          className={cn(
            "block rounded-sm border-2 border-ink shadow-[0_0_0_1.5px_var(--color-ink-foreground)] transition-transform",
            state === "active" ? "h-5 w-5" : "h-4 w-4 group-hover:scale-125",
            state === "linked" &&
              "shadow-[0_0_0_1.5px_var(--color-ink-foreground),0_0_0_4px_var(--color-ink)]",
            state === "candidate" && "cursor-crosshair",
          )}
          style={{ backgroundColor: type.color }}
        />
        {state !== "active" && (
          <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden max-w-48 -translate-x-1/2 truncate whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-xs text-ink-foreground group-hover:block">
            {location.name}
            {state === "linked" && <span className="ml-1.5 opacity-60">· connected</span>}
          </span>
        )}
      </div>
    </AdvancedMarker>
  );
}

// --- Connections ---------------------------------------------------------------------------

type LineEmphasis = "normal" | "strong" | "dim";

/** A single crisp ink stroke, close to the 2px ink border on the squares. */
const LINE_STYLE: Record<LineEmphasis, { weight: number; opacity: number; z: number }> = {
  normal: { weight: 1.5, opacity: 1, z: 2 },
  strong: { weight: 2, opacity: 1, z: 4 },
  dim: { weight: 1.5, opacity: 0.3, z: 1 },
};

function arrowIcon(weight: number, opacity: number): google.maps.IconSequence {
  return {
    icon: {
      path: ARROW_PATH,
      scale: 3.5,
      strokeColor: LINE_INK,
      strokeOpacity: opacity,
      strokeWeight: weight,
      fillOpacity: 0,
    },
    offset: "100%",
  };
}

/**
 * A directed connection: a straight ink line from one square to another, ending in a small open
 * chevron just outside the destination square. The line stops short of the destination's centre
 * by a fixed number of screen pixels (recomputed as you zoom) so the arrow is never hidden under
 * the square. It encodes direction only, not distance.
 */
function ConnectionLine({
  from,
  to,
  zoom,
  emphasis,
  interactive,
  onClick,
}: {
  from: Location;
  to: Location;
  zoom: number;
  emphasis: LineEmphasis;
  interactive: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const style = LINE_STYLE[hovered && interactive && emphasis !== "strong" ? "strong" : emphasis];
  const start = { lat: from.lat, lng: from.lng };
  const tip = pointBeforeEnd(start, to, zoom, ARROW_GAP_PX);
  // When the squares overlap on screen there's no room for an arrow; draw nothing until zoomed in.
  if (!tip) return null;
  const path = [start, tip];
  return (
    <>
      <Polyline
        path={path}
        strokeColor={LINE_INK}
        strokeOpacity={style.opacity}
        strokeWeight={style.weight}
        zIndex={style.z}
        clickable={false}
        icons={[arrowIcon(style.weight, style.opacity)]}
      />
      {interactive && (
        // Wide invisible stroke on top so a thin line is still easy to hover and click.
        <Polyline
          path={path}
          strokeColor={LINE_INK}
          strokeOpacity={0.01}
          strokeWeight={16}
          zIndex={20}
          onClick={onClick}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
        />
      )}
    </>
  );
}

/** Dashed line with an arrowhead from the origin to the cursor while choosing a destination. */
function DraftLine({ origin }: { origin: Location }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const start = { lat: origin.lat, lng: origin.lng };
    const line = new google.maps.Polyline({
      map,
      path: [start, start],
      clickable: false,
      strokeOpacity: 0,
      zIndex: 30,
      icons: [
        {
          icon: {
            path: "M 0,-1 0,1",
            strokeColor: LINE_INK,
            strokeOpacity: 0.8,
            strokeWeight: 1.5,
            scale: 3,
          },
          offset: "0",
          repeat: "10px",
        },
        arrowIcon(1.5, 0.8),
      ],
    });
    map.setOptions({ draggableCursor: "crosshair" });
    const listener = map.addListener("mousemove", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) line.setPath([start, event.latLng]);
    });
    return () => {
      listener.remove();
      line.setMap(null);
      map.setOptions({ draggableCursor: null });
    };
  }, [map, origin.lat, origin.lng]);
  return null;
}

// --- Cards ---------------------------------------------------------------------------------

/** An info card floating above a point on the map. */
function MapCard({
  position,
  gap,
  children,
}: {
  position: google.maps.LatLngLiteral;
  /** Space between the point and the card's bottom edge, in px. */
  gap: number;
  children: ReactNode;
}) {
  return (
    // Clickable so clicks on the card don't fall through to the map and clear the selection.
    <AdvancedMarker position={position} zIndex={1000} onClick={() => {}}>
      <div style={{ paddingBottom: gap }} className="font-display">
        <div className="w-64 cursor-default rounded-sm border border-ink-foreground/25 bg-ink p-3 text-left text-ink-foreground shadow-xl">
          {children}
        </div>
      </div>
    </AdvancedMarker>
  );
}

function CardLabel({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider opacity-80">
      {color && (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </div>
  );
}

function CardButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-sm bg-ink-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-ink outline-none transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-foreground"
    >
      {children}
    </button>
  );
}

// --- Camera --------------------------------------------------------------------------------

/**
 * Camera rules:
 * - On first load, and whenever a location is added, fit every location in view.
 * - Removing locations or connections leaves the camera alone.
 * - A focus request (clicking a row in the panel) frames those locations.
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
    frame(map, locations);
  }, [map, locations]);

  useEffect(() => {
    if (!map || !focus) return;
    const targets = locations.filter((l) => focus.ids.includes(l.id));
    if (targets.length === 1 && targets[0]) {
      map.panTo({ lat: targets[0].lat, lng: targets[0].lng });
      if ((map.getZoom() ?? 0) < 12) map.setZoom(SINGLE_LOCATION_ZOOM);
    } else if (targets.length > 1) {
      frame(map, targets);
    }
    // Only react to new focus requests, not to every locations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus]);

  return null;
}

function frame(map: google.maps.Map, locations: Location[]) {
  const [first] = locations;
  if (!first) return;
  if (locations.length === 1) {
    map.setCenter({ lat: first.lat, lng: first.lng });
    map.setZoom(SINGLE_LOCATION_ZOOM);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  for (const l of locations) bounds.extend({ lat: l.lat, lng: l.lng });
  map.fitBounds(bounds, FIT_PADDING);
}
