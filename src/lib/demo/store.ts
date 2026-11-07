"use client";

import { useSyncExternalStore } from "react";

import type { WeeklyHours } from "./hours";
import { INITIAL_STATE, parseState, reducer, type DemoAction } from "./reducer";
import type { DemoState, NewLocation } from "./types";

/**
 * Demo state lives in the browser (localStorage) for now. Everything that reads or writes it
 * goes through this module, so moving to a real backend later only means changing this file.
 */

export const STORAGE_KEY = "convoy.demo.v1";

type Saved = { version: 1; state: DemoState };

let state: DemoState | null = null;
const listeners = new Set<() => void>();

function readStorage(): DemoState {
  try {
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
    const saved: Saved = { version: 1, state: next };
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
  addType(name: string, color: string): string {
    const id = newId();
    dispatch({ type: "addType", id, name, color });
    return id;
  },
  renameType(id: string, name: string) {
    dispatch({ type: "updateType", id, name });
  },
  recolorType(id: string, color: string) {
    dispatch({ type: "updateType", id, color });
  },
  removeType(id: string, reassignTo?: string) {
    dispatch(
      reassignTo === undefined
        ? { type: "removeType", id }
        : { type: "removeType", id, reassignTo },
    );
  },
  addLocation(location: NewLocation): string {
    const id = newId();
    dispatch({ type: "addLocation", id, createdAt: new Date().toISOString(), location });
    return id;
  },
  renameLocation(id: string, name: string) {
    dispatch({ type: "updateLocation", id, name });
  },
  setLocationType(id: string, typeId: string) {
    dispatch({ type: "updateLocation", id, typeId });
  },
  setLocationHours(id: string, hours: WeeklyHours) {
    dispatch({ type: "updateLocation", id, hours });
  },
  removeLocation(id: string) {
    dispatch({ type: "removeLocation", id });
  },
  /** Add a directed connection fromId → toId. No-op if it already exists. */
  connectLocations(fromId: string, toId: string): string {
    const id = newId();
    dispatch({ type: "addConnection", id, fromId, toId });
    return id;
  },
  removeConnection(id: string) {
    dispatch({ type: "removeConnection", id });
  },
};

/** Test helper: forget the in-memory copy so the next read comes from storage again. */
export function __resetDemoStore() {
  state = null;
  emit();
}
