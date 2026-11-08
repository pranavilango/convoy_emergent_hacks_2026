"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { findConnection, outgoing } from "@/lib/demo/graph";
import { canSupply, KIND_INFO, LOCATION_KINDS, SUPPLIES } from "@/lib/demo/kinds";
import { demoActions, useDemoState } from "@/lib/demo/store";
import type { Location } from "@/lib/demo/types";

import { AddLocationForm } from "./add-location-form";
import {
  AllocationAnalysisDialog,
  type AllocationAnalysisResult,
} from "./allocation-analysis-dialog";
import { Button, focusRing, SectionLabel } from "./controls";
import { ConnectionsManager } from "./connections-manager";
import { KindMark, LocationKinds } from "./location-kinds";
import { LocationList } from "./location-list";
import { connectionCountLabel, MapView, type FocusRequest } from "./map-view";
import type { Selection } from "./selection";

/** Google's shared Map ID for testing. Advanced markers need *some* Map ID to render. */
const FALLBACK_MAP_ID = "DEMO_MAP_ID";

type MapProblem = "unconfigured" | "load-failed" | "auth-failed";

declare global {
  interface Window {
    /** Google Maps calls this global when the API key is rejected. */
    gm_authFailure?: () => void;
  }
}

export function DemoApp({ apiKey, mapId }: { apiKey?: string; mapId?: string }) {
  const { locations, connections } = useDemoState();
  const [rawSelection, setSelection] = useState<Selection>(null);
  const [rawConnectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [problem, setProblem] = useState<MapProblem | null>(apiKey ? null : "unconfigured");
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [analysisResult, setAnalysisResult] = useState<AllocationAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const hasRequiredLocationKinds = (["port", "warehouse", "clinic"] as const).every((kind) =>
    locations.some((location) => location.kind === kind),
  );

  useEffect(() => {
    if (!apiKey) return;
    window.gm_authFailure = () => setProblem("auth-failed");
    if (!mapId) {
      console.warn(
        `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID is not set; using ${FALLBACK_MAP_ID}. That's fine for development.`,
      );
    }
    return () => {
      delete window.gm_authFailure;
    };
  }, [apiKey, mapId]);

  // Ignore selections that point at something that no longer exists.
  const selection: Selection =
    rawSelection?.kind === "location" && locations.some((l) => l.id === rawSelection.id)
      ? rawSelection
      : rawSelection?.kind === "connection" && connections.some((c) => c.id === rawSelection.id)
        ? rawSelection
        : null;
  // Only ports and warehouses supply anything, so only they can be connected from.
  const connectingFrom =
    rawConnectingFrom &&
    !problem &&
    locations.some((l) => l.id === rawConnectingFrom && SUPPLIES[l.kind] !== null)
      ? rawConnectingFrom
      : null;
  const connectingLocation = connectingFrom
    ? locations.find((l) => l.id === connectingFrom)
    : undefined;

  // Escape leaves connect mode first, then clears the selection.
  useEffect(() => {
    if (!connectingFrom && !selection) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (connectingFrom) setConnectingFrom(null);
      else setSelection(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectingFrom, selection]);

  function selectLocationFromPanel(id: string | null) {
    setConnectingFrom(null);
    setSelection(id ? { kind: "location", id } : null);
    if (id) setFocus({ ids: [id], nonce: Date.now() });
  }

  function selectConnectionFromPanel(id: string | null) {
    setConnectingFrom(null);
    setSelection(id ? { kind: "connection", id } : null);
    const c = id ? connections.find((x) => x.id === id) : undefined;
    if (c) setFocus({ ids: [c.fromId, c.toId], nonce: Date.now() });
  }

  function startConnecting(id: string) {
    setSelection({ kind: "location", id });
    setConnectingFrom(id);
  }

  function stopConnecting() {
    setConnectingFrom(null);
  }

  async function analyzeNetwork() {
    setAnalysisStatus("loading");
    setAnalysisResult(null);
    setAnalysisError(null);

    try {
      const response = await fetch("/api/solar-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: {
            locations: locations.map(({ id, name, kind, portMode }) => ({
              id,
              name,
              kind,
              portMode,
            })),
            connections: connections.map(({ fromId, toId }) => ({ fromId, toId })),
          },
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Unable to analyze the network right now.";
        throw new Error(message);
      }

      if (!isAllocationAnalysisResult(payload)) {
        throw new Error("The analysis service returned an invalid response.");
      }

      setAnalysisResult(payload);
      setAnalysisStatus("ready");
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : "Unable to analyze the network right now.",
      );
      setAnalysisStatus("error");
    }
  }

  /** In connect mode, clicking a square toggles the supply link origin → that square. */
  function toggleConnection(targetId: string) {
    const origin = connectingLocation;
    const target = locations.find((l) => l.id === targetId);
    if (!origin || !target || !canSupply(origin.kind, target.kind)) return;
    const existing = findConnection(connections, origin.id, targetId);
    if (existing) demoActions.removeConnection(existing.id);
    else demoActions.connectLocations(origin.id, targetId);
  }

  const panel = (
    <div className="space-y-12 px-6 py-8 md:px-8">
      <AddLocationForm
        searchAvailable={problem === null}
        onAdded={(id) => {
          setConnectingFrom(null);
          setSelection({ kind: "location", id });
        }}
      />
      <LocationKinds locations={locations} />
      <LocationList
        locations={locations}
        connections={connections}
        selectedId={selection?.kind === "location" ? selection.id : null}
        onSelect={selectLocationFromPanel}
        {...(problem ? {} : { onStartConnecting: startConnecting })}
      />
      <ConnectionsManager
        locations={locations}
        connections={connections}
        selectedConnectionId={selection?.kind === "connection" ? selection.id : null}
        onSelectConnection={selectConnectionFromPanel}
      />
      <section aria-label="Solar allocation analysis" className="space-y-4">
        <SectionLabel index="04">Analysis</SectionLabel>
        <p className="text-sm leading-relaxed opacity-75">
          Get two suggested 24/7 warehouses or clinics with estimated supply wait times before and
          after, then analyze the results.
        </p>
        <Button
          onClick={analyzeNetwork}
          disabled={!hasRequiredLocationKinds || analysisStatus === "loading"}
          aria-busy={analysisStatus === "loading"}
          className="w-full"
        >
          {analysisStatus === "loading" ? "Analyzing…" : "Analyze"}
        </Button>
        {!hasRequiredLocationKinds && (
          <p className="text-xs opacity-70">
            Add at least one port, warehouse, and clinic to enable analysis.
          </p>
        )}
      </section>
    </div>
  );

  const mapArea = (
    <div className="relative h-full w-full bg-ink text-ink-foreground">
      {problem ? (
        <MapNotice problem={problem} />
      ) : (
        <MapView
          mapId={mapId || FALLBACK_MAP_ID}
          locations={locations}
          connections={connections}
          selection={selection}
          connectingFrom={connectingFrom}
          focus={focus}
          onSelect={setSelection}
          onConnectTo={toggleConnection}
          onStartConnecting={startConnecting}
          onRemoveConnection={(id) => {
            demoActions.removeConnection(id);
            setSelection(null);
          }}
          onBackgroundClick={() => (connectingFrom ? stopConnecting() : setSelection(null))}
        />
      )}
      {!problem && <Legend locations={locations} connectionCount={connections.length} />}
      {connectingLocation && (
        <ConnectBanner
          origin={connectingLocation}
          locations={locations}
          count={outgoing(connections, connectingLocation.id).length}
          onDone={stopConnecting}
        />
      )}
    </div>
  );

  const layout = (
    <div className="flex min-h-dvh flex-col bg-background font-display text-foreground md:h-dvh">
      <DemoHeader count={locations.length} connectionCount={connections.length} />
      <div className="flex flex-1 flex-col md:grid md:min-h-0 md:grid-cols-[minmax(22rem,26rem)_1fr]">
        <section aria-label="Map" className="order-1 h-[55vh] md:order-2 md:h-auto">
          {mapArea}
        </section>
        <aside
          aria-label="Network editor"
          className="order-2 border-foreground/30 md:order-1 md:overflow-y-auto md:border-r"
        >
          {panel}
        </aside>
      </div>
      {analysisStatus !== "idle" && (
        <AllocationAnalysisDialog
          status={analysisStatus}
          result={analysisResult}
          error={analysisError}
          onClose={() => {
            if (analysisStatus !== "loading") setAnalysisStatus("idle");
          }}
        />
      )}
    </div>
  );

  if (!apiKey) return layout;
  return (
    <APIProvider apiKey={apiKey} onError={() => setProblem("load-failed")}>
      {layout}
    </APIProvider>
  );
}

function isAllocationAnalysisResult(value: unknown): value is AllocationAnalysisResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("analysis" in value) ||
    typeof value.analysis !== "string" ||
    !("allocation" in value) ||
    typeof value.allocation !== "object" ||
    value.allocation === null
  ) {
    return false;
  }

  const allocation = value.allocation;
  return (
    "networkSummary" in allocation &&
    typeof allocation.networkSummary === "string" &&
    "recommendations" in allocation &&
    Array.isArray(allocation.recommendations) &&
    allocation.recommendations.length === 2 &&
    allocation.recommendations.every(
      (recommendation) =>
        typeof recommendation === "object" &&
        recommendation !== null &&
        "locationId" in recommendation &&
        typeof recommendation.locationId === "string" &&
        "locationName" in recommendation &&
        typeof recommendation.locationName === "string" &&
        "kind" in recommendation &&
        (recommendation.kind === "warehouse" || recommendation.kind === "clinic") &&
        "estimatedWaitHoursBefore" in recommendation &&
        typeof recommendation.estimatedWaitHoursBefore === "number" &&
        Number.isFinite(recommendation.estimatedWaitHoursBefore) &&
        recommendation.estimatedWaitHoursBefore >= 0 &&
        "estimatedWaitHoursAfter" in recommendation &&
        typeof recommendation.estimatedWaitHoursAfter === "number" &&
        Number.isFinite(recommendation.estimatedWaitHoursAfter) &&
        recommendation.estimatedWaitHoursAfter >= 0 &&
        recommendation.estimatedWaitHoursAfter < recommendation.estimatedWaitHoursBefore &&
        "rationale" in recommendation &&
        typeof recommendation.rationale === "string",
    ) &&
    "limitations" in allocation &&
    Array.isArray(allocation.limitations) &&
    allocation.limitations.every((limitation) => typeof limitation === "string")
  );
}

function ConnectBanner({
  origin,
  locations,
  count,
  onDone,
}: {
  origin: Location;
  locations: Location[];
  count: number;
  onDone: () => void;
}) {
  const target = SUPPLIES[origin.kind];
  const targets = target ? KIND_INFO[target].plural.toLowerCase() : "";
  const anyTargets = target !== null && locations.some((l) => l.kind === target);
  return (
    <div
      role="status"
      className="absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-4 rounded-sm bg-foreground px-4 py-3 text-background shadow-lg md:left-1/2 md:right-auto md:w-[26rem] md:-translate-x-1/2"
    >
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-wider opacity-70">
          _Connecting · {connectionCountLabel(count)}
        </div>
        <p className="mt-0.5 truncate text-sm">
          {anyTargets ? (
            <>
              Click {targets} that <strong>{origin.name}</strong> supplies. Click again to unlink.
            </>
          ) : (
            <>No {targets} on the map yet. Add one to connect it.</>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="shrink-0 rounded-sm bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground outline-none hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background"
      >
        Done · Esc
      </button>
    </div>
  );
}

function DemoHeader({ count, connectionCount }: { count: number; connectionCount: number }) {
  return (
    <header className="flex items-center justify-between border-b border-foreground/30 px-6 py-4 md:px-10">
      <div className="flex items-center gap-6">
        <Link
          href="/"
          className={`flex items-center gap-2 text-lg font-semibold tracking-tight ${focusRing}`}
        >
          <span className="inline-block h-4 w-4 rounded-sm bg-foreground" />
          Convoy
        </Link>
        <span className="hidden font-mono text-[11px] uppercase tracking-wider sm:inline">
          _Demo / Network
        </span>
      </div>
      <div className="flex items-center gap-6">
        <span className="hidden font-mono text-[11px] uppercase tracking-wider md:inline">
          {String(count).padStart(2, "0")} {count === 1 ? "location" : "locations"} ·{" "}
          {connectionCountLabel(connectionCount)}
        </span>
        <Link
          href="/"
          className={`rounded-sm border border-foreground px-4 py-2 text-sm transition-colors hover:bg-foreground hover:text-background ${focusRing}`}
        >
          ← Back to site
        </Link>
      </div>
    </header>
  );
}

function Legend({
  locations,
  connectionCount,
}: {
  locations: Location[];
  connectionCount: number;
}) {
  return (
    // Bottom-left, above Google's logo, so it never collides with the connect banner up top.
    <div className="pointer-events-none absolute bottom-9 left-3 rounded-sm border border-ink-foreground/15 bg-ink/90 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-foreground shadow-lg backdrop-blur-sm">
      <ul className="space-y-1.5">
        {LOCATION_KINDS.map((kind) => (
          <li key={kind} className="flex items-center gap-2">
            <KindMark kind={kind} className="h-3.5 w-3.5 text-[8px]" />
            <span>{KIND_INFO[kind].plural}</span>
            <span className="ml-auto pl-3 opacity-60">
              {String(locations.filter((l) => l.kind === kind).length).padStart(2, "0")}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-ink-foreground/15 pt-1.5">
          {/* Aquamarine like the lines' core (the legend's ink is their outline). */}
          <span aria-hidden className="inline-block w-3.5 text-center leading-none text-background">
            →
          </span>
          <span>Supply link</span>
          <span className="ml-auto pl-3 opacity-60">
            {String(connectionCount).padStart(2, "0")}
          </span>
        </li>
      </ul>
    </div>
  );
}

const NOTICES: Record<MapProblem, { title: string; body: ReactNode }> = {
  unconfigured: {
    title: "Google Maps isn't configured",
    body: (
      <>
        Add <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> and{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID</code> to{" "}
        <code className="font-mono text-xs">.env.local</code>, then restart the dev server.
      </>
    ),
  },
  "load-failed": {
    title: "Google Maps didn't load",
    body: "Check your connection and reload. If it keeps happening, look for errors in the browser console.",
  },
  "auth-failed": {
    title: "Google rejected the API key",
    body: "Make sure billing is on, Maps JavaScript API and Places API (New) are enabled, and the key's website restrictions include this address.",
  },
};

function MapNotice({ problem }: { problem: MapProblem }) {
  const notice = NOTICES[problem];
  return (
    <div role="status" className="flex h-full items-center justify-center p-8">
      <div className="max-w-md">
        <div className="font-mono text-[11px] uppercase tracking-wider opacity-70">_Map</div>
        <p className="mt-4 text-3xl leading-[1.05] tracking-[-0.04em]">{notice.title}</p>
        <p className="mt-4 text-sm opacity-70">{notice.body}</p>
      </div>
    </div>
  );
}
