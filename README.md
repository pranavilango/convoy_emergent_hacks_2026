# medroute — solar-power allocator for medicine delivery

In regions with unreliable electricity, clinics and relay hubs that store
medicine (cold chain, intake, dispensing) are only open for a few hours a day.
Given a delivery network and a budget of `n` solar installations, **medroute
finds the `n` nodes that, when kept open from 00:00 to 23:00, minimise the
priority-weighted time it takes medicine to reach clinics.**

It is a Rust library (the algorithm) plus a small HTTP server
(`POST /api/analyze`).

## The problem

* A connected, directed, acyclic, tripartite graph: **sources** (in-degree 0)
  → **pass-throughs** → **destinations** (out-degree 0).
* Each node holds `(c, option<t>, option<p>)`: location `c`; opening window
  `t = [a, b]`, `0 ≤ a < b < 24` (none for sources); priority `p` (destinations
  only).
* Time-to-delivery = transit(source→pass-through) + wait for pass-through +
  transit(pass-through→destination) + wait for destination; transit is
  straight-line distance at 60 km/h.
* Per destination: minimum over all sources/pass-throughs. Network:
  `Σ pᵢ·ttdᵢ / Σ pᵢ`.
* Choose `n` nodes whose window becomes `[0, 23]` (open 24/7) to minimise that
  value. If `n` is at least the number of pass-throughs and destinations, all of
  them are returned.

Interpretation choices (the statement is ambiguous in places) are listed in
[`src/lib.rs`](src/lib.rs) and [`API.md`](API.md): deliveries follow graph
edges; distance is haversine; "at a given time" is the departure time, averaged
over every whole hour 0–23 (fixed, not configurable from the file); a window
`[a, b]` means `[a, b+1)`, so `[0, 23]` is 24/7; only pass-throughs and
destinations are upgradable because sources have no window.

## Design

Types first, so invalid states cannot be represented:

| Type | Guarantees |
|------|-----------|
| `Latitude`, `Longitude`, `Coordinate` | finite, in range |
| `TimeWindow` | `0 ≤ start < end < 24`; owns the "wait until open" logic |
| `Priority` | finite, non-negative |
| `NodeIndex` | index into one graph (no raw `usize` mixing) |
| `Node` (enum) | `Source` / `PassThrough` / `Destination` carry exactly the fields they need |
| `Graph` | only built via `Graph::new`, which checks layering, degrees, connectivity, positive total priority and pre-computes one `Route` (list of `Leg`s) per destination |
| `UpgradeSet` | which nodes are `[0, 23]` |
| `Strategy` / `SolverUsed` | request vs. what actually ran |

There are no overloaded/catch-all types: no `Option` pairs standing in for
roles, no stringly-typed kinds past the parser, and distinct error enums
(`ModelError`, `InputError`, `SolveError`, `AnalyzeError`).

Algorithm (`src/lib.rs`):

1. **Evaluation** — `destination_time_to_delivery` → `average_time_to_delivery`
   → `weighted_time_to_delivery`. Because waiting-until-open is monotone in
   arrival time and sources never wait, only the *fastest source per
   pass-through* matters, so each evaluation is `O(destinations × departures ×
   pass-throughs per destination)`.
2. **Search** — `exact_search` enumerates all `C(m, n)` subsets of the `m`
   upgradable nodes (guaranteed optimal). `greedy_search` adds the best node `n`
   times, then applies single-node swaps until none improves. `solve` picks
   between them (`auto` = exact when `C(m, n)` ≤ `MEDROUTE_EXACT_MAX_COMBINATIONS`).
   The problem is not submodular in general, so greedy is a heuristic.
3. **I/O** — `parse_graph_file`, `analyze_bytes`, `ServerSettings`.

`src/main.rs` is only HTTP glue (axum); the CPU-bound search runs on a blocking
thread.

## Running

Requires a recent stable Rust toolchain (1.85+ at the time of writing).

```bash
cargo run --release
# in another shell
curl -F file=@examples/network.json "http://127.0.0.1:8080/api/analyze?n=2"
```

Format and error details: [`API.md`](API.md).

## Configuration (no recompilation needed)

Read at start-up from environment variables; a `.env` file in the working
directory is loaded too (real environment variables win). Copy
`.env.example` to `.env` to start.

| Variable | Default | Meaning |
|----------|---------|---------|
| `MEDROUTE_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose on all interfaces; IPv6 allowed). |
| `MEDROUTE_PORT` | `8080` | TCP port. |
| `MEDROUTE_MAX_UPLOAD_BYTES` | `10485760` (10 MiB) | Largest accepted upload; larger gets `413`. |
| `MEDROUTE_EXACT_MAX_COMBINATIONS` | `200000` | Max `C(m, n)` for exact search. Raise for guaranteed optimality on bigger inputs (slower), lower to answer faster with the heuristic. |

```bash
MEDROUTE_PORT=9000 MEDROUTE_HOST=0.0.0.0 ./target/release/medroute
```

An invalid value makes the server exit with a message naming the variable.

## Testing

```bash
cargo test
```

`tests/tests.rs` (119 tests) covers every public function:

* primitives (validation, haversine distances, half-open window wait-time
  table, boundary and wrap-around cases);
* graph validation (every error variant) and route pre-computation;
* evaluation with hand-computed expectations (zero-transit scenarios where the
  answer follows from the windows alone), min-over-sources/pass-throughs,
  priorities and departure averaging;
* combinatorics helpers, exact search vs. an independent bit-mask brute force on
  random graphs, greedy sanity bounds, tie-breaking, strategy selection;
* file parsing and every input error path, settings parsing;
* end-to-end HTTP tests that launch the real binary on a free port: success
  paths, each error status, and environment-variable behaviour (limits,
  invalid config, port in use).

## Layout

```
Cargo.toml          manifest (Cargo requires this exact capitalisation)
src/lib.rs          types, graph validation, evaluation, search, parsing, settings
src/main.rs         HTTP server
tests/tests.rs      unit + end-to-end tests
examples/           sample network
API.md              request/response reference
.env.example        configuration template
```