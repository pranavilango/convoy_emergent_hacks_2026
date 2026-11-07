# transit

Time-dependent transit analysis over a directed acyclic graph of nodes that have opening
hours and coordinates, plus an HTTP API for storing networks and finding changes that
reduce average transit time.

- **Library** (`src/lib.rs`): graph types, earliest-arrival transit times, performance
  evaluation, and a greedy optimizer.
- **Server** (`src/main.rs`): the `transit-server` binary exposing `/api/upload`,
  `/api/analyze` and `/api/change`.
- **API reference:** see [`API.md`](API.md) for the file format, request/response formats and errors.

## Quick start

Requires Rust 1.75 or newer.

```sh
cargo run --release --bin transit-server
# transit-server listening on http://127.0.0.1:3000 (storage: networks)
```

Upload a network, then ask for improvements:

```sh
curl -X POST localhost:3001/api/upload -H 'Content-Type: application/json' -d '{
  "network_name": "demo",
  "content": {"nodes": [
    {"id": 0, "hours": {"start": 0, "end": 24}, "coordinates": {"x": 0,  "y": 0}},
    {"id": 1, "parents": [0], "hours": {"start": 0, "end": 24}, "coordinates": {"x": 0,  "y": 60}},
    {"id": 2, "parents": [1], "hours": {"start": 0, "end": 24}, "coordinates": {"x": 60, "y": 0}}
  ]}
}'

curl -X POST localhost:3001/api/analyze -H 'Content-Type: application/json' \
  -d '{"network_name": "demo"}'
# {"network_name":"demo","original_performance":1.609...,"optimized_performance":1.138...,
#  "suggested_changes":[{"type":"add_edge","parent":0,"child":2}]}
```

## Configuration

The server is configured only through environment variables, which are read at startup in
`main()` in `src/main.rs`. There is no config file, and `.env` files are not loaded
automatically.

| Variable              | Default          | Meaning                                              |
|-----------------------|------------------|------------------------------------------------------|
| `TRANSIT_ADDR`        | `127.0.0.1:3000` | Socket address to listen on. Use `0.0.0.0:3000` to accept outside connections |
| `TRANSIT_STORAGE_DIR` | `./networks`     | Directory holding network files (created if missing) |
| `TRANSIT_MAX_NODES`   | `100`            | Maximum nodes per network, enforced on upload and `add_node` |

Example:

```sh
TRANSIT_ADDR=0.0.0.0:8080 TRANSIT_STORAGE_DIR=/var/lib/transit TRANSIT_MAX_NODES=50 \
  ./target/release/transit-server
```

Invalid values (an unparsable address, a non-numeric node limit) make the server exit at
startup with a message naming the variable.

The default `TRANSIT_MAX_NODES` is conservative because analysis time grows steeply with
network size (about 8 s for 100 nodes and 48 s for 200 with `max_changes: 5`; see
[`API.md`](API.md#limits-and-performance)). The server has **no authentication**, so keep it on a
trusted network or behind an authenticating proxy, especially if you change `TRANSIT_ADDR`.

## Storage

Each network is one file, `<TRANSIT_STORAGE_DIR>/<network_name>.json`. Files are written
atomically, and you can also drop hand-written files into the directory; they are read on
demand. Network names are limited to 1–64 characters from `A-Z a-z 0-9 - _`.

## Project layout

```
Cargo.toml            package manifest (library + transit-server binary)
Cargo.lock            pinned dependencies (keep this; see Notes)
API.md                file format and API reference
src/lib.rs            analysis library
src/main.rs           HTTP server (types, conversions, operations, handlers, API tests)
tests/transit_tests.rs  library test suite
```

## Tests

```sh
cargo test
```

This runs the library tests (`tests/transit_tests.rs`, 43 tests, including property tests on
random graphs checked against an independent reference implementation) and the API tests in
`src/main.rs` (18 tests that drive the real router against a temporary storage directory).

## Using the library directly

```rust
use transit::*;

let mut graph = TransitGraph::new();
graph.add_node(NodeId(0), NodeMetadata {
    parents: NodeList(vec![]),
    interval: TimeInterval::new(0, 24).unwrap(),
    coordinates: Coordinates(0.0, 0.0),
})?;

let service = GraphService::default();
let hours = service.calculate_transit_time(&graph, NodeId(0), NodeId(1), 9.0);
let score = service.evaluate_performance(&graph);
let plan = service.suggest_optimal_changes(&graph);
```

Key semantics: edges run parent to child, coordinates are in km, travel is 60 km/h, nodes are
open on `[start, end)`, waiting is allowed, and performance averages transit time over the
reachable ordered pairs at start hours 9 through 17. Details are in `API.md` and the doc
comments in `src/lib.rs`.

## Notes

- `Cargo.lock` pins `tokio` and `hyper-util` to older releases so the project builds on
  Rust 1.75. On a newer toolchain you can run `cargo update` to take the latest versions.
- The optimizer is greedy and capped by `max_changes`, so its output is a good set of
  changes, not a proven optimum.