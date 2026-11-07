"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useDemoState } from "@/lib/demo/store";
import type { Location, LocationType } from "@/lib/demo/types";

import { AddLocationForm } from "./add-location-form";
import { focusRing } from "./controls";
import { LocationList } from "./location-list";
import { LocationTypeManager } from "./location-type-manager";
import { MapView, type FocusRequest } from "./map-view";

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
  const { types, locations } = useDemoState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [problem, setProblem] = useState<MapProblem | null>(apiKey ? null : "unconfigured");

  useEffect(() => {
    if (!apiKey) return;
    window.gm_authFailure = () => setProblem("auth-failed");
    if (!mapId) {
      console.warn(
        `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID is not set; using ${FALLBACK_MAP_ID}. The map won't use the Convoy style.`,
      );
    }
    return () => {
      delete window.gm_authFailure;
    };
  }, [apiKey, mapId]);

  // Drop a selection that points at a location that no longer exists (e.g. its type was deleted).
  const selected = selectedId && locations.some((l) => l.id === selectedId) ? selectedId : null;

  function selectFromList(id: string | null) {
    setSelectedId(id);
    if (id) setFocus({ id, nonce: Date.now() });
  }

  const panel = (
    <div className="space-y-12 px-6 py-8 md:px-8">
      <AddLocationForm
        types={types}
        searchAvailable={problem === null}
        onAdded={(id) => setSelectedId(id)}
      />
      <LocationList
        locations={locations}
        types={types}
        selectedId={selected}
        onSelect={selectFromList}
      />
      <LocationTypeManager types={types} locations={locations} />
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
          types={types}
          selectedId={selected}
          focus={focus}
          onSelect={setSelectedId}
        />
      )}
      {!problem && <Legend types={types} locations={locations} />}
    </div>
  );

  const layout = (
    <div className="flex min-h-dvh flex-col bg-background font-display text-foreground md:h-dvh">
      <DemoHeader count={locations.length} />
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
    </div>
  );

  if (!apiKey) return layout;
  return (
    <APIProvider apiKey={apiKey} onError={() => setProblem("load-failed")}>
      {layout}
    </APIProvider>
  );
}

function DemoHeader({ count }: { count: number }) {
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
          {String(count).padStart(2, "0")} {count === 1 ? "location" : "locations"} mapped
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

function Legend({ types, locations }: { types: LocationType[]; locations: Location[] }) {
  if (types.length === 0) return null;
  const counts = new Map<string, number>();
  for (const l of locations) counts.set(l.typeId, (counts.get(l.typeId) ?? 0) + 1);
  return (
    <div className="pointer-events-none absolute left-4 top-4 rounded-sm bg-ink/90 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-foreground shadow-lg backdrop-blur-sm">
      <ul className="space-y-1.5">
        {types.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: t.color }}
            />
            <span className="max-w-40 truncate">{t.name}</span>
            <span className="ml-auto pl-3 opacity-60">
              {String(counts.get(t.id) ?? 0).padStart(2, "0")}
            </span>
          </li>
        ))}
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
