"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the demo's guided tour is showing. It opens by itself the first time someone visits
 * the demo in this browser; finishing or skipping it remembers that, and the header's Tour button
 * opens it again.
 */

export const TOUR_STORAGE_KEY = "convoy.tour.v1";

let open: boolean | null = null;
const listeners = new Set<() => void>();

function firstVisit(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === null;
  } catch {
    // Storage blocked: don't risk showing the tour on every page load.
    return false;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => (open ??= firstVisit());
// Closed while server rendering and hydrating; it opens right after, on the client.
const getServerSnapshot = () => false;

export function useTourOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function openTour() {
  open = true;
  emit();
}

/** Finished or skipped: close it and don't open it by itself again. */
export function closeTour() {
  open = false;
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "seen");
  } catch {
    // Storage blocked: it stays closed for this visit.
  }
  emit();
}

/** Test helper: forget the in-memory state so the next read comes from storage again. */
export function __resetTour() {
  open = null;
  emit();
}
