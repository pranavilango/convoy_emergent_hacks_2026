import { ENGINE_WASM_BASE64 } from "./engine-binary";

/**
 * The Rust allocator (src/lib.rs) compiled to WebAssembly and run inside this server, so Analyze
 * works anywhere Next.js runs (including Vercel) without a separate service. Same library and
 * same results as the medroute HTTP API; see medroute-wasm/src/lib.rs for the small ABI.
 * Rebuild with `npm run build:engine` after changing the Rust code. Server-side only: it's
 * imported by the Analyze route's helpers, never by a client component.
 */

type EngineExports = {
  memory: WebAssembly.Memory;
  medroute_alloc(len: number): number;
  medroute_analyze(ptr: number, len: number, n: number): number;
  medroute_free(ptr: number, len: number): void;
};

/** What the engine returns: the HTTP API's success body, or its error and status. */
export type EngineResult = { ok: unknown } | { error: string; status: number };

let compiled: WebAssembly.Module | null = null;

/** Run one analysis on a graph file (the JSON format in API.md) for `n` solar units. */
export function runEngine(graphJson: string, n: number): EngineResult {
  compiled ??= new WebAssembly.Module(Buffer.from(ENGINE_WASM_BASE64, "base64"));
  // A fresh instance per call: no state leaks between requests, and it's cheap.
  const engine = new WebAssembly.Instance(compiled, {}).exports as unknown as EngineExports;

  const input = new TextEncoder().encode(graphJson);
  const inputPtr = engine.medroute_alloc(input.length);
  new Uint8Array(engine.memory.buffer, inputPtr, input.length).set(input);

  const outPtr = engine.medroute_analyze(inputPtr, input.length, n);
  const length = new DataView(engine.memory.buffer).getUint32(outPtr, true);
  const json = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, outPtr + 4, length));
  engine.medroute_free(outPtr, 4 + length);
  return JSON.parse(json) as EngineResult;
}
