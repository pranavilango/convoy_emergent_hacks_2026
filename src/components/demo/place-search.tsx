"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import { FieldLabel } from "./controls";

export type PickedPlace = {
  name: string;
  address: string;
  placeId: string;
  lat: number;
  lng: number;
};

type Suggestion = {
  placeId: string;
  main: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction;
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

const SEARCH_ERROR =
  "Search isn't working. Check that Places API (New) is enabled for this key and that the key allows this site.";

/**
 * Address autocomplete built on Places API (New). Rendered as our own combobox (instead of
 * Google's widget) so it matches the site. One session token spans the typing and the final
 * details lookup, which is how Google bills it as a single session.
 */
export function PlaceSearch({ onPick }: { onPick: (place: PickedPlace) => void }) {
  const places = useMapsLibrary("places");
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounced suggestion fetch. Late responses from older queries are ignored.
  useEffect(() => {
    const input = query.trim();
    if (!places || input.length < MIN_QUERY_LENGTH) return;
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        sessionToken.current ??= new places.AutocompleteSessionToken();
        const { suggestions: results } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            sessionToken: sessionToken.current,
          });
        if (seq !== requestSeq.current) return;
        const next: Suggestion[] = [];
        for (const s of results) {
          const p = s.placePrediction;
          if (!p) continue;
          next.push({
            placeId: p.placeId,
            main: p.mainText?.text ?? p.text.text,
            secondary: p.secondaryText?.text ?? "",
            prediction: p,
          });
        }
        setSuggestions(next);
        setActiveIndex(next.length ? 0 : -1);
        setOpen(true);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        console.error(err);
        setSuggestions([]);
        setError(SEARCH_ERROR);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [places, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    }
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex]);

  function onQueryChange(value: string) {
    setQuery(value);
    setError(null);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      requestSeq.current++; // drop any in-flight request
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
    }
  }

  async function pick(suggestion: Suggestion) {
    setOpen(false);
    setLoading(true);
    requestSeq.current++;
    try {
      // toPlace() carries the session token, closing the billing session with this lookup.
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
      const location = place.location;
      if (!location) throw new Error(`Place ${suggestion.placeId} has no coordinates`);
      onPick({
        name: place.displayName ?? suggestion.main,
        address: place.formattedAddress ?? [suggestion.main, suggestion.secondary].join(", "),
        placeId: place.id,
        lat: location.lat(),
        lng: location.lng(),
      });
      setQuery("");
      setSuggestions([]);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(SEARCH_ERROR);
    } finally {
      sessionToken.current = null;
      setLoading(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = suggestions.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open && count) setOpen(true);
        else if (count) setActiveIndex((i) => (i + 1) % count);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (count) setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
        return;
      case "Enter": {
        const s = open ? suggestions[activeIndex] : undefined;
        if (s) {
          event.preventDefault();
          void pick(s);
        }
        return;
      }
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        } else if (query) {
          onQueryChange("");
        }
        return;
    }
  }

  const ready = places !== null;
  const showList = open && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div ref={rootRef} className="relative">
      <FieldLabel htmlFor={inputId}>Search an address</FieldLabel>
      <div className="flex items-center gap-2 border-b border-foreground focus-within:shadow-[0_1px_0_0_var(--color-foreground)]">
        <span aria-hidden className="font-mono text-xs">
          ↗
        </span>
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={error ? `${baseId}-error` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={!ready}
          placeholder={ready ? "e.g. 221B Baker Street, London" : "Loading search…"}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 bg-transparent py-2 text-base outline-none placeholder:text-foreground/50 disabled:opacity-50"
        />
        {loading && (
          <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">…</span>
        )}
      </div>

      {error && (
        <p id={`${baseId}-error`} role="alert" className="mt-2 text-xs">
          {error}
        </p>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-sm bg-ink py-1 text-ink-foreground shadow-lg"
        >
          {suggestions.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm opacity-70">No matches.</li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              onPointerMove={() => setActiveIndex(i)}
              // mousedown, not click: keeps focus in the input so the list doesn't blur away.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pick(s)}
              className={cn(
                "cursor-pointer px-3 py-2",
                i === activeIndex && "bg-ink-foreground/10",
              )}
            >
              <span className="block truncate text-sm">{s.main}</span>
              {s.secondary && (
                <span className="block truncate text-xs opacity-60">{s.secondary}</span>
              )}
            </li>
          ))}
          <li
            aria-hidden
            className="border-t border-ink-foreground/15 px-3 pb-1 pt-2 text-right font-mono text-[10px] uppercase tracking-wider opacity-50"
          >
            Results by Google
          </li>
        </ul>
      )}
    </div>
  );
}
