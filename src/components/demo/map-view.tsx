"use client";

import { AdvancedMarker, ColorScheme, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import {
  distanceKm,
  formatDistance,
  letterSize,
  MIN_LETTER_PX,
  pointBeforeEnd,
  squareSize,
  visualMidpoint,
} from "@/lib/demo/geometry";
import { degrees, findConnection, involves } from "@/lib/demo/graph";
import { summarizeHours } from "@/lib/demo/hours";
import {
  canSupply,
  isLocationKind,
  KIND_INFO,
  kindLabel,
  SUPPLIES,
  type LocationKind,
} from "@/lib/demo/kinds";
import { peopleLabel } from "@/lib/demo/population";
import { cannotReceiveToday, formatPower } from "@/lib/demo/power";
import type { Connection, Location } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

import { DRAG_KIND_TYPE } from "./location-kinds";
import type { Selection } from "./selection";

/** A new site dropped on the map, waiting for its details in the Add a location form. */
export type PendingPin = { kind: LocationKind; lat: number; lng: number };

const DEFAULT_CENTER = { lat: 30, lng: 0 };
const DEFAULT_ZOOM = 2;
const SINGLE_LOCATION_ZOOM = 14;
const FIT_PADDING = { top: 160, right: 60, bottom: 60, left: 60 };

/** Connection lines are an aquamarine core (the site accent) inside an ink casing, like a road on
 *  a map: the ink edge holds against bright imagery, the aquamarine against dark ground and
 *  water. The ink matches the squares' borders. */
const LINE_INK = "#050a0f";
const LINE_CORE = "#4dd0b7";
/** Squares grow by this much when selected. */
const ACTIVE_GROWTH_PX = 4;
/** Space between the arrow tip and the destination square, beyond the square's cream ring. */
const ARROW_CLEARANCE_PX = 3.5;
/** Open chevron like the site's → glyph. Symbol "up" (−y) points along the line, tip at 0,0. */
const ARROW_PATH = "M -1,1.6 0,0 1,1.6";

/** Ask the map to frame some locations. `nonce` lets the same request be repeated. */
export type FocusRequest = { ids: string[]; nonce: number };

export function MapView({
  mapId,
  locations,
  connections,
  poweredIds,
  selection,
  connectingFrom,
  focus,
  onSelect,
  onConnectTo,
  onStartConnecting,
  onRemoveConnection,
  onBackgroundClick,
  placing,
  pendingPin,
  onPlace,
  onDeleteLocation,
}: {
  mapId: string;
  locations: Location[];
  connections: Connection[];
  /** Sites the latest (still current) analysis chose for solar; they light up. */
  poweredIds: ReadonlySet<string> | null;
  selection: Selection;
  /** When set, clicking a location this one can supply connects (or disconnects) it. */
  connectingFrom: string | null;
  focus: FocusRequest | null;
  onSelect: (selection: Selection) => void;
  onConnectTo: (locationId: string) => void;
  onStartConnecting: (locationId: string) => void;
  onRemoveConnection: (connectionId: string) => void;
  onBackgroundClick: () => void;
  /** A kind waiting to be placed: the next click on the map puts it there. */
  placing: LocationKind | null;
  /** Shown as a dashed square until its details are saved. */
  pendingPin: PendingPin | null;
  /** A kind dropped (or click-placed) at an exact point on the map. */
  onPlace: (kind: LocationKind, lat: number, lng: number) => void;
  /** Delete a location (from its card) and its connections. */
  onDeleteLocation: (locationId: string) => void;
}) {
  const locationById = new globalThis.Map(locations.map((l) => [l.id, l]));
  const degreeById = degrees(connections);

  // The location whose links are emphasised: the one being connected from, else the selected one.
  const focusLocationId = connectingFrom ?? (selection?.kind === "location" ? selection.id : null);
  const selectedConnectionId = selection?.kind === "connection" ? selection.id : null;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  // Squares (and their letters) shrink as you zoom out; see squareSize().
  const size = squareSize(zoom);

  const selectedLocation =
    selection?.kind === "location" && !connectingFrom ? locationById.get(selection.id) : undefined;
  const selectedConnection = selectedConnectionId
    ? connections.find((c) => c.id === selectedConnectionId)
    : undefined;
  const toLatLng = useScreenToLatLng();
  const [dropTarget, setDropTarget] = useState(false);

  return (
    // Location types dragged from the editor land at the exact point they're dropped on.
    <div
      className="relative h-full w-full"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_KIND_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!dropTarget) setDropTarget(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false);
      }}
      onDrop={(event) => {
        setDropTarget(false);
        const kind = event.dataTransfer.getData(DRAG_KIND_TYPE);
        if (!isLocationKind(kind)) return;
        event.preventDefault();
        const point = toLatLng(event.clientX, event.clientY);
        if (point) onPlace(kind, point.lat, point.lng);
      }}
    >
      <Map
        mapId={mapId}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        // Flat road map in Google's built-in dark scheme: no Cloud Console styling needed. Can only
        // be set when the map is created.
        mapTypeId="roadmap"
        colorScheme={ColorScheme.DARK}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        clickableIcons={false}
        reuseMaps
        onClick={(event) => {
          const point = event.detail.latLng;
          if (placing && point) onPlace(placing, point.lat, point.lng);
          else onBackgroundClick();
        }}
        {...(placing ? { draggableCursor: "crosshair" } : {})}
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
              // Half the destination square, its 1.5px cream ring, and a little clearance.
              arrowGap={
                (size + (to.id === focusLocationId ? ACTIVE_GROWTH_PX : 0)) / 2 +
                1.5 +
                ARROW_CLEARANCE_PX
              }
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
          const isOrigin = location.id === connectingFrom;
          const powered = poweredIds?.has(location.id) ?? false;
          const noPower = cannotReceiveToday(location);
          const origin = connectingFrom ? locationById.get(connectingFrom) : undefined;
          const state: SquareState =
            isOrigin || location.id === focusLocationId
              ? "active"
              : !origin
                ? "idle"
                : !canSupply(origin.kind, location.kind)
                  ? "unavailable"
                  : findConnection(connections, origin.id, location.id)
                    ? "linked"
                    : "candidate";
          return (
            <LocationSquare
              key={location.id}
              location={location}
              state={state}
              powered={powered}
              dark={noPower && !powered}
              relit={noPower && powered}
              size={size}
              onClick={() => {
                if (!connectingFrom) onSelect({ kind: "location", id: location.id });
                else if (state === "linked" || state === "candidate") onConnectTo(location.id);
              }}
            />
          );
        })}

        {selectedLocation && (
          <MapCard position={selectedLocation} gap={(size + ACTIVE_GROWTH_PX) / 2 + 4}>
            <div className="flex items-start justify-between gap-2">
              <CardLabel color={KIND_INFO[selectedLocation.kind].color}>
                {kindLabel(selectedLocation)}
              </CardLabel>
              <CardDeleteButton
                name={selectedLocation.name}
                onClick={() => onDeleteLocation(selectedLocation.id)}
              />
            </div>
            <p className="mt-1.5 text-base leading-tight tracking-tight">{selectedLocation.name}</p>
            <p className="mt-1 text-xs leading-snug opacity-60">{selectedLocation.address}</p>
            {poweredIds?.has(selectedLocation.id) && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-aqua">
                Chosen for solar
              </p>
            )}
            {selectedLocation.kind === "clinic" && (
              <p className="mt-2 text-sm">
                {selectedLocation.population === null ? (
                  <span className="opacity-70">Population not set</span>
                ) : (
                  <>Serves {peopleLabel(selectedLocation.population)}</>
                )}
              </p>
            )}
            <ul className="mt-2.5 space-y-0.5 font-mono text-[10px] uppercase tracking-wider opacity-80">
              {selectedLocation.kind === "port" ? (
                <li>Open 24/7</li>
              ) : (
                <>
                  {summarizeHours(selectedLocation.hours).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  <li>Grid power {formatPower(selectedLocation.gridPower).toLowerCase()}</li>
                  {cannotReceiveToday(selectedLocation) && (
                    <li className={poweredIds?.has(selectedLocation.id) ? "text-aqua" : ""}>
                      {poweredIds?.has(selectedLocation.id)
                        ? "Solar lets it take in medicines"
                        : "No power while staffed: can't take in medicines"}
                    </li>
                  )}
                </>
              )}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-ink-foreground/15 pt-2.5">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
                {connectionCountLabel(degreeById.get(selectedLocation.id) ?? 0)}
              </span>
              {/* Clinics are the end of the chain: nothing to connect to. */}
              {SUPPLIES[selectedLocation.kind] && (
                <CardButton onClick={() => onStartConnecting(selectedLocation.id)}>
                  Connect ↘
                </CardButton>
              )}
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
              <CardLabel>Supply link</CardLabel>
              <p className="mt-1.5 text-sm leading-snug">
                {locationById.get(selectedConnection.fromId)!.name}
                <span aria-hidden className="mx-1.5 font-mono opacity-60">
                  →
                </span>
                <span className="sr-only"> to </span>
                {locationById.get(selectedConnection.toId)!.name}
              </p>
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider opacity-80">
                {formatDistance(
                  distanceKm(
                    locationById.get(selectedConnection.fromId)!,
                    locationById.get(selectedConnection.toId)!,
                  ),
                )}{" "}
                straight line
              </p>
              <div className="mt-3 flex justify-end border-t border-ink-foreground/15 pt-2.5">
                <CardButton onClick={() => onRemoveConnection(selectedConnection.id)}>
                  Remove
                </CardButton>
              </div>
            </MapCard>
          )}

        {pendingPin && <PendingSquare pin={pendingPin} size={size} />}

        <CameraController locations={locations} focus={focus} />
      </Map>
      {dropTarget && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 border border-aqua bg-aqua/5"
        />
      )}
    </div>
  );
}

/**
 * Screen point → map coordinates, through the map's own projection (an empty overlay is the
 * standard way to get it), so a drop lands exactly under the pointer at any zoom.
 */
function useScreenToLatLng() {
  const map = useMap();
  const overlay = useRef<google.maps.OverlayView | null>(null);
  useEffect(() => {
    if (!map) return;
    const view = new google.maps.OverlayView();
    view.onAdd = () => {};
    view.draw = () => {};
    view.onRemove = () => {};
    view.setMap(map);
    overlay.current = view;
    return () => {
      view.setMap(null);
      overlay.current = null;
    };
  }, [map]);
  return (clientX: number, clientY: number): { lat: number; lng: number } | null => {
    const projection = overlay.current?.getProjection();
    if (!map || !projection) return null;
    const box = map.getDiv().getBoundingClientRect();
    const point = projection.fromContainerPixelToLatLng(
      new google.maps.Point(clientX - box.left, clientY - box.top),
    );
    return point ? { lat: point.lat(), lng: point.lng() } : null;
  };
}

/** A dropped site that isn't saved yet: its kind's square, dashed and see-through. */
function PendingSquare({ pin, size }: { pin: PendingPin; size: number }) {
  const side = size + ACTIVE_GROWTH_PX;
  const letter = letterSize(side);
  return (
    <AdvancedMarker
      position={{ lat: pin.lat, lng: pin.lng }}
      title={`New ${KIND_INFO[pin.kind].label.toLowerCase()} (not saved yet)`}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={950}
    >
      <div className="relative font-display">
        <span
          className="flex items-center justify-center rounded-sm border-2 border-dashed border-ink-foreground font-semibold leading-none text-ink opacity-80"
          style={{
            width: side,
            height: side,
            fontSize: letter || MIN_LETTER_PX,
            backgroundColor: KIND_INFO[pin.kind].color,
          }}
        >
          <span aria-hidden className={cn(letter === 0 && "opacity-0")}>
            {KIND_INFO[pin.kind].letter}
          </span>
        </span>
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-ink-foreground/25 bg-ink px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-foreground">
          New · add details
        </span>
      </div>
    </AdvancedMarker>
  );
}

export function connectionCountLabel(count: number): string {
  return `${String(count).padStart(2, "0")} ${count === 1 ? "connection" : "connections"}`;
}

// --- Locations -----------------------------------------------------------------------------

/** In connect mode, "linked" and "candidate" squares can be clicked; "unavailable" ones are a
 *  kind the origin can't supply, so they're dimmed. */
type SquareState = "idle" | "active" | "linked" | "candidate" | "unavailable";

/**
 * A location drawn as a square centred exactly on its coordinates, so connection lines meet the
 * middle of each square. It carries its kind's letter (P, W, C) while it's big enough to read:
 * zoomed out, the square and letter shrink together, and the letter fades out below 8px so the
 * square shows color only.
 */
function LocationSquare({
  location,
  state,
  size,
  powered,
  dark,
  relit,
  onClick,
}: {
  location: Location;
  state: SquareState;
  /** Chosen for solar by the latest analysis: an aquamarine ring that powers on. */
  powered: boolean;
  /** Never has grid power while it's staffed, and not (yet) chosen for solar: its colour is
   *  shown in black and white, letter and all, like a building with the lights off. */
  dark: boolean;
  /** Was dark, and the latest analysis gives it solar: its colour powers back on. */
  relit: boolean;
  /** Side in px at the current zoom (selected squares are a little bigger). */
  size: number;
  onClick: () => void;
}) {
  const side = state === "active" ? size + ACTIVE_GROWTH_PX : size;
  const letter = letterSize(side);
  return (
    <AdvancedMarker
      position={{ lat: location.lat, lng: location.lng }}
      title={`${location.name} (${kindLabel(location)}${powered ? ", chosen for solar" : dark ? ", no power while staffed" : ""})`}
      onClick={onClick}
      anchorLeft="-50%"
      anchorTop="-50%"
      zIndex={state === "active" ? 900 : state === "idle" || state === "unavailable" ? null : 800}
      className="group"
    >
      <div className="relative font-display">
        {powered && (
          <span
            aria-hidden
            className="flicker-in pointer-events-none absolute -inset-[5px] rounded-sm border-2 border-aqua shadow-[0_0_12px_2px_var(--color-aqua)]"
          />
        )}
        <span
          className={cn(
            "flex items-center justify-center rounded-sm border-2 border-ink font-semibold leading-none text-ink shadow-[0_0_0_1.5px_var(--color-ink-foreground)] transition-[width,height,font-size,transform] duration-150",
            state !== "active" && "group-hover:scale-125",
            state === "linked" &&
              "shadow-[0_0_0_1.5px_var(--color-ink-foreground),0_0_0_4px_var(--color-ink)]",
            state === "candidate" && "cursor-crosshair",
            state === "unavailable" && "cursor-not-allowed opacity-35 group-hover:scale-100",
            dark && "grayscale",
            relit && "flicker-in",
          )}
          style={{
            width: side,
            height: side,
            // Hold the smallest size while hidden so the letter fades out rather than vanishing.
            fontSize: letter || MIN_LETTER_PX,
            backgroundColor: KIND_INFO[location.kind].color,
          }}
        >
          <span
            aria-hidden
            className={cn("transition-opacity duration-150", letter === 0 && "opacity-0")}
          >
            {KIND_INFO[location.kind].letter}
          </span>
        </span>
        {state !== "active" && state !== "unavailable" && (
          <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden max-w-48 -translate-x-1/2 truncate whitespace-nowrap rounded-sm border border-ink-foreground/25 bg-ink px-2 py-1 text-xs text-ink-foreground group-hover:block">
            {location.name}
            {state === "linked" && <span className="ml-1.5 opacity-60">· supplied</span>}
            {powered && <span className="ml-1.5 text-aqua">· solar</span>}
            {dark && <span className="ml-1.5 opacity-60">· no power while staffed</span>}
          </span>
        )}
      </div>
    </AdvancedMarker>
  );
}

// --- Connections ---------------------------------------------------------------------------

type LineEmphasis = "normal" | "strong" | "dim";

/** `core` is the aquamarine stroke; the ink casing adds 1px on each side. */
const LINE_STYLE: Record<LineEmphasis, { core: number; opacity: number; z: number }> = {
  normal: { core: 1.5, opacity: 1, z: 2 },
  strong: { core: 2.5, opacity: 1, z: 4 },
  dim: { core: 1.5, opacity: 0.4, z: 1 },
};
const CASING_PX = 2;

function arrowIcon(color: string, weight: number, opacity: number): google.maps.IconSequence {
  return {
    icon: {
      path: ARROW_PATH,
      scale: 3.5,
      strokeColor: color,
      strokeOpacity: opacity,
      strokeWeight: weight,
      fillOpacity: 0,
    },
    offset: "100%",
  };
}

/**
 * A directed connection: a thin aquamarine line with an ink outline from one square to another,
 * ending in a matching open chevron just outside the destination square. The line stops short of
 * the destination's centre by `arrowGap` screen pixels (recomputed as you zoom) so the arrow is
 * never hidden under the square. Its length on the map is the straight-line distance shown in
 * the card.
 */
function ConnectionLine({
  from,
  to,
  zoom,
  arrowGap,
  emphasis,
  interactive,
  onClick,
}: {
  from: Location;
  to: Location;
  zoom: number;
  arrowGap: number;
  emphasis: LineEmphasis;
  interactive: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const style = LINE_STYLE[hovered && interactive && emphasis !== "strong" ? "strong" : emphasis];
  const start = { lat: from.lat, lng: from.lng };
  const tip = pointBeforeEnd(start, to, zoom, arrowGap);
  // When the squares overlap on screen there's no room for an arrow; draw nothing until zoomed in.
  if (!tip) return null;
  const path = [start, tip];
  return (
    <>
      {/* Casing first, core on top; each line keeps its own pair so crossings read cleanly. */}
      <Polyline
        path={path}
        strokeColor={LINE_INK}
        strokeOpacity={style.opacity}
        strokeWeight={style.core + CASING_PX}
        zIndex={style.z * 2}
        clickable={false}
        icons={[arrowIcon(LINE_INK, style.core + CASING_PX, style.opacity)]}
      />
      <Polyline
        path={path}
        strokeColor={LINE_CORE}
        strokeOpacity={style.opacity}
        strokeWeight={style.core}
        zIndex={style.z * 2 + 1}
        clickable={false}
        icons={[arrowIcon(LINE_CORE, style.core, style.opacity)]}
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

/** Dashed line with an arrowhead from the origin to the cursor while choosing a destination,
 *  in the same aquamarine-in-ink style as the connection lines. */
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
      // Icons draw in order, so each casing goes before its core.
      icons: [LINE_INK, LINE_CORE].flatMap((color, i) => {
        const weight = i === 0 ? 1.5 + CASING_PX : 1.5;
        return [
          {
            icon: { path: "M 0,-1 0,1", strokeColor: color, strokeWeight: weight, scale: 3 },
            offset: "0",
            repeat: "10px",
          },
          arrowIcon(color, weight, 1),
        ];
      }),
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

/** Red bin + "Delete" in a location card's top corner. */
function CardDeleteButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Delete ${name}`}
      title={`Delete ${name}`}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
      className="-mr-1 -mt-1 inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-destructive transition-colors outline-none hover:bg-destructive/15 focus-visible:outline-1 focus-visible:outline-destructive"
    >
      <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
      Delete
    </button>
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
      className="rounded-sm bg-aqua px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-night outline-none transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aqua"
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
