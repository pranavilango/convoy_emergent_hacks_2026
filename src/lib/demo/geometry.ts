/**
 * Small Web Mercator helpers. Map lines are straight in Mercator space, so anything measured
 * "on screen" (midpoints, trimming a line by N pixels) has to be computed there, not in lat/lng.
 */

type LatLng = { lat: number; lng: number };
type Point = { x: number; y: number };

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
