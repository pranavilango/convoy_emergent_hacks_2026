# Transit Network API

An HTTP/JSON API for storing transit networks and finding changes that reduce average
transit time. It wraps the `transit` library (`src/lib.rs`); the server is `src/main.rs`.

- [Running the server](#running-the-server)
- [Concepts and units](#concepts-and-units)
- [Network file format](#network-file-format)
- [Change format](#change-format)
- [`POST /api/upload`](#post-apiupload)
- [`POST /api/analyze`](#post-apianalyze)
- [`POST /api/change`](#post-apichange)
- [Errors](#errors)
- [Limits and performance](#limits-and-performance)

## Running the server

```sh
cargo run --release --bin transit-server
```

| Environment variable  | Default          | Meaning                                  |
|-----------------------|------------------|------------------------------------------|
| `TRANSIT_ADDR`        | `127.0.0.1:3000` | Address to listen on                     |
| `TRANSIT_STORAGE_DIR` | `./networks`     | Directory holding network files          |
| `TRANSIT_MAX_NODES`   | `100`            | Maximum nodes allowed in one network     |

All endpoints are `POST` and exchange JSON. Request bodies are limited to 2 MB.

## Concepts and units

- A network is a **directed acyclic graph**. Each node lists its **parents**; an edge
  `parent -> child` means you can travel from the parent to the child, **not** the reverse.
- **Coordinates** are in kilometres. Travel runs in a straight line at **60 km/h**, so an edge
  of length `D` km takes `D / 60` hours.
- **Hours** `{"start": a, "end": b}` mean the node is open on the half-open interval
  `[a, b)` in whole hours, with `0 <= a < b <= 24`. Intervals never wrap past midnight.
- You may **wait** at a node. A hop `u -> v` is possible if you can leave `u` while it is open
  and arrive at `v` while it is open; any waiting is included in the transit time.
- **Performance** is the average transit time (in hours) over every ordered pair of distinct,
  reachable nodes, for every integer start hour 9 through 17. Samples that are unreachable
  are left out of the average. Lower is better.

## Network file format

A network is stored as `<TRANSIT_STORAGE_DIR>/<network_name>.json`. You can also place
files in that directory by hand; they are read on demand.

```json
{
  "nodes": [
    {
      "id": 0,
      "parents": [],
      "hours": { "start": 0, "end": 24 },
      "coordinates": { "x": 0.0, "y": 0.0 }
    },
    {
      "id": 1,
      "parents": [0],
      "hours": { "start": 9, "end": 17 },
      "coordinates": { "x": 0.0, "y": 60.0 }
    },
    {
      "id": 2,
      "parents": [1],
      "hours": { "start": 0, "end": 24 },
      "coordinates": { "x": 60.0, "y": 0.0 }
    }
  ]
}
```

| Field                | Type            | Required | Notes                                        |
|----------------------|-----------------|----------|----------------------------------------------|
| `nodes`              | array of node   | yes      | May be empty                                 |
| `nodes[].id`         | integer ≥ 0     | yes      | Unique within the network                    |
| `nodes[].parents`    | array of ids    | no       | Defaults to `[]`. Must refer to existing nodes, never to the node itself |
| `nodes[].hours`      | object          | yes      | `start` and `end` integers, `0 <= start < end <= 24` |
| `nodes[].coordinates`| object          | yes      | `x` and `y` numbers, in km                   |

Rules:

- Nodes may be listed in any order; the server orders them as needed.
- The graph must be acyclic.
- Unknown fields are rejected (this catches typos such as `parent` for `parents`).
- Files written by the server are **canonical**: nodes sorted by `id`, `parents` sorted and
  de-duplicated, and every field present.

**Network names** (used in file names) must be 1–64 characters from `A-Z a-z 0-9 - _`.
Anything else is rejected with `400`.

## Change format

A change is an object with a `type` field. The same format is used as input to
[`/api/change`](#post-apichange) and as the output of the optimizer in
[`/api/analyze`](#post-apianalyze).

| `type`         | Fields                                  | Effect                                              |
|----------------|-----------------------------------------|-----------------------------------------------------|
| `update_hours` | `node` (id), `hours` (`{start, end}`)   | Replace the node's opening hours                    |
| `add_edge`     | `parent` (id), `child` (id)             | Add edge `parent -> child`; fails if it exists, or would create a cycle or self-loop |
| `remove_edge`  | `parent` (id), `child` (id)             | Remove an existing edge                             |
| `add_node`     | `node` (a [node object](#network-file-format)) | Add a node; its `id` must be unused and its `parents` must exist. Not produced by the optimizer |

```json
{ "type": "update_hours", "node": 1, "hours": { "start": 8, "end": 17 } }
{ "type": "add_edge", "parent": 0, "child": 2 }
{ "type": "remove_edge", "parent": 1, "child": 2 }
{ "type": "add_node", "node": { "id": 3, "parents": [2], "hours": { "start": 8, "end": 20 }, "coordinates": { "x": 90, "y": 0 } } }
```

## `POST /api/upload`

Validates a network and stores it as a new file.

**Request**

```json
{
  "network_name": "demo",
  "content": { "nodes": [ ... ] },
  "overwrite": false
}
```

| Field          | Type             | Required | Notes |
|----------------|------------------|----------|-------|
| `network_name` | string           | yes      | Also accepted as `network-name` or `name` |
| `content`      | object or string | yes      | The [network file](#network-file-format) as a JSON object, **or** as a string containing the file's JSON text |
| `overwrite`    | boolean          | no       | Default `false`. If `true`, replace an existing network |

**Response** — `201 Created` for a new network, `200 OK` if an existing one was replaced:

```json
{ "network_name": "demo", "node_count": 3, "replaced": false }
```

Nothing is written if validation fails. An existing network and `overwrite: false` gives `409`.

```sh
curl -X POST localhost:3000/api/upload -H 'Content-Type: application/json' -d '{
  "network_name": "demo",
  "content": {"nodes": [
    {"id": 0, "hours": {"start": 0, "end": 24}, "coordinates": {"x": 0,  "y": 0}},
    {"id": 1, "parents": [0], "hours": {"start": 0, "end": 24}, "coordinates": {"x": 0,  "y": 60}},
    {"id": 2, "parents": [1], "hours": {"start": 0, "end": 24}, "coordinates": {"x": 60, "y": 0}}
  ]}
}'
```

## `POST /api/analyze`

Loads a stored network and returns the optimizer's suggested changes. The network is **not**
modified; apply the suggestions with [`/api/change`](#post-apichange).

**Request**

```json
{ "network_name": "demo", "config": { "max_changes": 5 } }
```

| Field                         | Type    | Required | Notes |
|-------------------------------|---------|----------|-------|
| `network_name`                | string  | yes      | Also accepted as `network-name` or `name` |
| `config`                      | object  | no       | Optimizer overrides; omitted fields use defaults |
| `config.max_changes`          | integer | no       | Default 5, maximum 50 |
| `config.max_edge_candidates`  | integer | no       | Shortcut edges scored per round. Default 25, maximum 500 |
| `config.min_improvement`      | number  | no       | A change must lower the average by more than this (hours). Default `1e-9`, must be ≥ 0 |

**Response** — `200 OK`

```json
{
  "network_name": "demo",
  "original_performance": 1.6094757082487297,
  "optimized_performance": 1.1380711874576985,
  "suggested_changes": [
    { "type": "add_edge", "parent": 0, "child": 2 }
  ]
}
```

| Field                   | Notes |
|-------------------------|-------|
| `original_performance`  | Average transit time in hours before any change (`0` if no pairs are reachable) |
| `optimized_performance` | Average transit time after applying `suggested_changes` **in order** |
| `suggested_changes`     | [Changes](#change-format) of type `update_hours` or `add_edge`; empty if nothing helps |

How suggestions are chosen: the optimizer greedily picks, one at a time, the single change
(extending a node's hours earlier, later, or to the full day; or adding a shortcut edge) that
lowers the average most. A change is rejected if it would reduce the number of reachable
(start hour, pair) samples, so connectivity is never traded away to improve the average.
Because it is greedy and capped by `max_changes`, the result is a good set of changes, not a
proven optimum.

```sh
curl -X POST localhost:3000/api/analyze -H 'Content-Type: application/json' \
  -d '{"network_name": "demo"}'
```

## `POST /api/change`

Applies one or more changes to a stored network and saves the result.

**Request**

```json
{
  "network_name": "demo",
  "changes": [
    { "type": "add_edge", "parent": 0, "child": 2 },
    { "type": "update_hours", "node": 1, "hours": { "start": 8, "end": 18 } }
  ]
}
```

| Field          | Type   | Required | Notes |
|----------------|--------|----------|-------|
| `network_name` | string | yes      | Also accepted as `network-name` or `name` |
| `changes`      | array  | yes      | At least one [change](#change-format), applied in order |

Changes are **atomic**: if any one fails, none are saved and the response names the failing
change (`"change #1: ..."`, zero-based). You can pass `suggested_changes` from
`/api/analyze` directly as `changes`.

**Response** — `200 OK`

```json
{
  "network_name": "demo",
  "applied": 2,
  "network": { "nodes": [ ... ] }
}
```

`network` is the saved network after the changes, in the canonical file format.

## Errors

Every error is JSON with a single `error` string:

```json
{ "error": "network 'nope' not found" }
```

| Status | When |
|--------|------|
| `400 Bad Request` | Malformed JSON, unknown or missing fields, invalid network name, invalid network (duplicate ids, unknown parent, cycle, bad hours, too many nodes), invalid or inapplicable change, out-of-range `config` |
| `404 Not Found`   | The named network does not exist (`/api/analyze`, `/api/change`) |
| `409 Conflict`    | `/api/upload` for a name that already exists without `overwrite: true` |
| `500 Internal Server Error` | A stored file is unreadable or invalid (e.g. edited by hand), or an I/O error. I/O details are logged on the server, not returned |

## Limits and performance

- **Node limit:** `TRANSIT_MAX_NODES` (default 100) is enforced on upload and on `add_node`.
- **Analysis cost grows steeply with size.** Every candidate change is scored by re-evaluating
  the whole network, so a request does roughly *(candidates per round) × (rounds) × (all-pairs
  shortest paths × 9 start hours)* of work. Measured on random networks (release build, one
  core, `max_changes` 1 / 5):

  | Nodes | `max_changes: 1` | `max_changes: 5` |
  |------:|-----------------:|-----------------:|
  | 30    | 0.1 s            | 0.4 s            |
  | 100   | 1.7 s            | 8.5 s            |
  | 200   | 9.1 s            | 47.7 s           |

  Analysis runs on a blocking thread so other requests are still served, but a long analysis
  occupies a core. Lower `max_changes` / `max_edge_candidates` for large networks.
- **Concurrency:** `/api/upload` and `/api/change` are serialized by a lock, so concurrent
  changes to the same network are never lost. Files are written atomically (temp file, then
  rename), so `/api/analyze` never reads a half-written file.
- **No authentication.** Anyone who can reach the server can read, create and modify networks.
  Run it on a trusted network or behind an authenticating proxy.
