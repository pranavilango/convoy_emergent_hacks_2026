"use client";

import { useSyncExternalStore } from "react";

import type { WeeklyHours } from "./hours";
import type { LocationKind, PortMode } from "./kinds";
import { INITIAL_STATE, parseState, reducer, type DemoAction } from "./reducer";
import type { DemoState, NewLocation } from "./types";

/**
 * Demo state lives in the browser (localStorage) for now. Everything that reads or writes it
 * goes through this module, so moving to a real backend later only means changing this file.
 */

export const STORAGE_KEY = "convoy.demo.v2";
/** Data from before Convoy's medical supply network (factories, retail stores…). It doesn't map
 *  onto ports, warehouses, and clinics, so it's discarded rather than converted. */
const LEGACY_STORAGE_KEYS = ["convoy.demo.v1"];

type Saved = { version: 2; state: DemoState };

let state: DemoState | null = null;
const listeners = new Set<() => void>();

function readStorage(): DemoState {
  try {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return INITIAL_STATE;
    const saved: unknown = JSON.parse(raw);
    const parsed =
      typeof saved === "object" && saved !== null && "state" in saved
        ? parseState((saved as { state: unknown }).state)
        : null;
    return parsed ?? INITIAL_STATE;
  } catch {
    // Private mode, blocked storage, or corrupt JSON: start fresh rather than crash.
    return INITIAL_STATE;
  }
}

function writeStorage(next: DemoState) {
  try {
    const saved: Saved = { version: 2, state: next };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Quota exceeded or storage blocked: keep working in memory for this session.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function getSnapshot(): DemoState {
  state ??= readStorage();
  return state;
}

function getServerSnapshot(): DemoState {
  return INITIAL_STATE;
}

function onStorage(event: StorageEvent) {
  // Keep other open tabs in sync.
  if (event.key !== STORAGE_KEY) return;
  state = readStorage();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function dispatch(action: DemoAction) {
  const current = getSnapshot();
  const next = reducer(current, action);
  if (next === current) return;
  state = next;
  writeStorage(next);
  emit();
}

export function useDemoState(): DemoState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function newId(): string {
  return crypto.randomUUID();
}

export const demoActions = {
  replaceState(next: DemoState) {
    dispatch({ type: "replace", state: next });
  },
  addLocation(location: NewLocation): string {
    const id = newId();
    dispatch({ type: "addLocation", id, createdAt: new Date().toISOString(), location });
    return id;
  },
  renameLocation(id: string, name: string) {
    dispatch({ type: "updateLocation", id, name });
  },
  /** Also removes connections the new kind can't have (see `connectionsBrokenByKind`). */
  setLocationKind(id: string, kind: LocationKind) {
    dispatch({ type: "updateLocation", id, kind });
  },
  setPortMode(id: string, portMode: PortMode) {
    dispatch({ type: "updateLocation", id, portMode });
  },
  setPopulation(id: string, population: number) {
    dispatch({ type: "updateLocation", id, population });
  },
  setLocationHours(id: string, hours: WeeklyHours) {
    dispatch({ type: "updateLocation", id, hours });
  },
  removeLocation(id: string) {
    dispatch({ type: "removeLocation", id });
  },
  /** Add a supply link fromId → toId (port → warehouse or warehouse → clinic). No-op if it
   *  already exists or breaks the chain. */
  connectLocations(fromId: string, toId: string): string {
    const id = newId();
    dispatch({ type: "addConnection", id, fromId, toId });
    return id;
  },
  removeConnection(id: string) {
    dispatch({ type: "removeConnection", id });
  },
  /** Null clears the amount. */
  setUnitCost(unitCost: number | null) {
    dispatch({ type: "setBudget", unitCost });
  },
  setTotalBudget(total: number | null) {
    dispatch({ type: "setBudget", total });
  },
};

/** Test helper: forget the in-memory copy so the next read comes from storage again. */
export function __resetDemoStore() {
  state = null;
  emit();
}
