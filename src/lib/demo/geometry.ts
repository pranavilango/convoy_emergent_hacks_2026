/**
 * Small Web Mercator helpers. Map lines are straight in Mercator space, so anything measured
 * "on screen" (midpoints, trimming a line by N pixels) has to be computed there, not in lat/lng.
 */

type LatLng = { lat: number; lng: number };
type Point = { x: number; y: number };

/** Mean Earth radius in km. */
const EARTH_RADIUS_KM = 6371.0088;

/** Straight-line (great-circle) distance between two points, in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "<0.1 km", "0.8 km" under 10 km, then whole km with thousands separators ("42 km",
 *  "1,204 km"). */
export function formatDistance(km: number): string {
  if (km < 0.05) return "<0.1 km";
  if (km < 10) return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

// --- Marker scale ----------------------------------------------------------------------------

/** Square side in px at a zoom level: 24px from street level (zoom ≥ 12) down to 12px for whole
 *  countries and continents (zoom ≤ 4), shrinking smoothly in between. */
export function squareSize(zoom: number): number {
  const size = 12 + 1.5 * (zoom - 4);
  return Math.round(Math.min(24, Math.max(12, size)) * 2) / 2;
}

/** Smallest letter worth drawing; below this it's noise, so the square shows color only. */
export const MIN_LETTER_PX = 8;

/** Letter size for a square of `size` px, or 0 when the square is too small to hold one. */
export function letterSize(size: number): number {
  const px = Math.round(size * 0.55);
  return px >= MIN_LETTER_PX ? px : 0;
}

/** Size of the Mercator world at zoom 0, in pixels (Google's convention). */
const TILE = 256;

export function toWorld({ lat, lng }: LatLng): Point {
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: TILE * (0.5 + lng / 360),
    y: TILE * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
  };
}

export function fromWorld({ x, y }: Point): LatLng {
  const n = Math.PI - (2 * Math.PI * y) / TILE;
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lng: (x / TILE - 0.5) * 360,
  };
}

/** Midpoint of the straight on-screen segment between two points. */
export function visualMidpoint(a: LatLng, b: LatLng): LatLng {
  const p = toWorld(a);
  const q = toWorld(b);
  return fromWorld({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
}

/** On-screen length of the segment a→b at `zoom`, in CSS pixels. */
export function screenDistance(a: LatLng, b: LatLng, zoom: number): number {
  const p = toWorld(a);
  const q = toWorld(b);
  return Math.hypot(q.x - p.x, q.y - p.y) * 2 ** zoom;
}

/**
 * The point `px` screen pixels before `to` along the straight line from → to, at `zoom`.
 * Used to stop a connection line at the edge of the destination square so its arrowhead shows.
 * Returns null when the line is too short to trim that much.
 */
export function pointBeforeEnd(from: LatLng, to: LatLng, zoom: number, px: number): LatLng | null {
  const p = toWorld(from);
  const q = toWorld(to);
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  const trim = px / 2 ** zoom;
  if (length <= trim) return null;
  const t = (length - trim) / length;
  return fromWorld({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
}
