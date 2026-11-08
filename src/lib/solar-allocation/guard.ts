import { createHash } from "node:crypto";

/**
 * Protection for the public Analyze route, which spends Gemini quota on every new analysis:
 * - a rate limit per client (by IP) and overall, so a script can't run up the bill;
 * - a short-lived cache, so re-running the same network (as in a live demo) is instant, free,
 *   and doesn't count against the limit.
 *
 * Both live in this server instance's memory. Vercel reuses warm instances, so this stops bursts
 * and loops; for a hard cap across instances, also add a rate-limit rule in Vercel's Firewall.
 */

type Limit = { max: number; windowMs: number };

/** Generous per client: judges and teammates on one venue Wi-Fi can share an IP. */
export const PER_CLIENT: Limit = { max: 30, windowMs: 10 * 60_000 };
/** Everyone together, per server instance. */
export const OVERALL: Limit = { max: 300, windowMs: 60 * 60_000 };

const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const MAX_TRACKED_CLIENTS = 10_000;

const hitsByClient = new Map<string, number[]>();
let allHits: number[] = [];
const cache = new Map<string, { value: unknown; expires: number }>();

/** The caller's IP. On Vercel, x-forwarded-for is set by the platform, not the client. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Count one analysis for `client`, or say how long to wait if a limit is reached. */
export function takeAnalysis(
  client: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const recent = (hitsByClient.get(client) ?? []).filter((t) => now - t < PER_CLIENT.windowMs);
  allHits = allHits.filter((t) => now - t < OVERALL.windowMs);

  const waitFor = (oldest: number, limit: Limit) => ({
    ok: false as const,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)),
  });
  if (recent.length >= PER_CLIENT.max) return waitFor(recent[0]!, PER_CLIENT);
  if (allHits.length >= OVERALL.max) return waitFor(allHits[0]!, OVERALL);

  recent.push(now);
  allHits.push(now);
  hitsByClient.delete(client); // Re-insert so the map stays ordered oldest client first.
  hitsByClient.set(client, recent);
  if (hitsByClient.size > MAX_TRACKED_CLIENTS) {
    const oldest = hitsByClient.keys().next().value;
    if (oldest !== undefined) hitsByClient.delete(oldest);
  }
  return { ok: true };
}

/** A stable key for an analysis request (the network and unit count, exactly as sent). */
export function requestKey(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export function cachedAnalysis(key: string, now = Date.now()): unknown {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheAnalysis(key: string, value: unknown, now = Date.now()) {
  cache.delete(key);
  cache.set(key, { value, expires: now + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** "about 3 minutes" / "about 40 seconds". */
export function waitLabel(seconds: number): string {
  if (seconds < 60) return `about ${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Test helper: forget all counts and cached results. */
export function __resetAnalysisGuard() {
  hitsByClient.clear();
  allHits = [];
  cache.clear();
}
