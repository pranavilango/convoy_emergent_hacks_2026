# medroute HTTP API

Base URL: `http://<MEDROUTE_HOST>:<MEDROUTE_PORT>` (default `http://127.0.0.1:8080`).

| Method | Path           | Purpose                                   |
|--------|----------------|-------------------------------------------|
| POST   | `/api/analyze` | Choose the `n` nodes to give solar power  |
| GET    | `/health`      | Liveness probe, returns `200` with `ok`   |

---

## `POST /api/analyze`

Upload a network and receive the list of nodes that should get solar power
(switching each to its solar window, `[0, 23]` by default) so that the weighted
time-to-delivery is minimised.

### Request

* **Content-Type:** `multipart/form-data`
* **Part `file`** (required): the graph, a JSON document (format below). Other
  parts are ignored; the first part named `file` is used.
* **Query parameters**

| Name       | Type                              | Required | Default | Meaning |
|------------|-----------------------------------|----------|---------|---------|
| `n`        | integer ≥ 1                       | yes      |         | How many nodes to upgrade. If it exceeds the number of pass-throughs + destinations, every one of them is returned. |
| `strategy` | `auto` \| `exact` \| `greedy`     | no       | `auto`  | `exact` tries every combination (rejected with 422 if more than `MEDROUTE_EXACT_MAX_COMBINATIONS`). `greedy` builds greedily and then improves by swaps (fast, not guaranteed optimal). `auto` = `exact` when allowed, else `greedy`. |

```bash
curl -F file=@examples/network.json "http://127.0.0.1:8080/api/analyze?n=2"
```

### File format (JSON)

```jsonc
{
  "nodes": [
    { "id": "depot",  "kind": "source",       "latitude": -1.29, "longitude": 36.82 },
    { "id": "hub",    "kind": "pass_through", "latitude": -0.30, "longitude": 36.08,
      "open_from": 8, "open_until": 16 },
    { "id": "clinic", "kind": "destination",  "latitude":  0.28, "longitude": 34.75,
      "open_from": 10, "open_until": 14, "priority": 40 }
  ],
  "edges": [
    { "from": "depot", "to": "hub" },
    { "from": "hub",   "to": "clinic" }
  ],
}
```

This is the tuple `(c, option<t>, option<p>)` of the problem statement: `c` =
`latitude`/`longitude`; `t` = `open_from`/`open_until` (absent for sources);
`p` = `priority` (present only for destinations). Unknown fields are rejected —
in particular `departure_hours` is **not** accepted (see Semantics).

| Field | Type | Rules |
|-------|------|-------|
| `nodes[].id` | string | Unique. |
| `nodes[].kind` | `"source"` \| `"pass_through"` \| `"destination"` | Determines which other fields are required. |
| `latitude` / `longitude` | number | `[-90, 90]` / `[-180, 180]`, degrees. |
| `open_from`, `open_until` | integer | Pass-throughs and destinations only, unless `closed`. `0 ≤ open_from ≤ open_until < 24`. `[a, b]` means the half-open daily interval `[a:00, (b+1):00)`; e.g. `[8, 16]` is open 08:00–17:00, `[8, 8]` is open one hour (08:00–09:00), and `[0, 23]` is open 24/7. |
| `closed` | boolean | Optional, pass-throughs and destinations only; default `false`. `true` means the node can't take in deliveries at all without solar power (e.g. it is never staffed while the grid is on). Give no `open_from`/`open_until` then (`422` otherwise). The node stays in the network: every delivery to it counts as a full day's wait (24 h, longer than any open node can cause), and upgrading it switches it to its solar window. |
| `solar_open_from`, `solar_open_until` | integer | Optional, pass-throughs and destinations only; give both or neither. The window the node gets with solar power, same format as `open_from`/`open_until`, and it must contain that window. Default `[0, 23]` (open 24/7). Use it when solar removes a power limit but the site is still only staffed part of the day. |
| `priority` | number | Destinations only. Finite, `≥ 0`; the sum over destinations must be `> 0`. |
| `edges[].from` / `to` | string | Node ids. Only `source → pass_through` and `pass_through → destination` are allowed; no duplicates. |

Structural rules (violations → `422`): every source has an outgoing edge, every
pass-through has incoming *and* outgoing edges, every destination has an
incoming edge, and the graph is (weakly) connected.

### Semantics

* A delivery runs `source → pass-through → destination` along existing edges.
  Time-to-delivery from a departure time `h` =
  transit(source, pass-through) + wait until the pass-through is open +
  transit(pass-through, destination) + wait until the destination is open.
* Transit time = great-circle (haversine) distance ÷ 60 km/h.
* A destination's time-to-delivery at `h` is the minimum over all sources and
  pass-throughs that can reach it. It is averaged over the departure times
  `h = 0, 1, …, 23` (every whole hour). This is fixed; the file cannot change it.
* Network objective = Σ (priority × average time-to-delivery) ÷ Σ priority.
* At a `closed` node the wait is always 24 h, whatever the arrival time.
* Upgrading a node replaces its window with its solar window (`[0, 23]`, open
  24/7, unless `solar_open_from`/`solar_open_until` say otherwise). Only
  pass-throughs and destinations can be upgraded. If `n` is at least their
  number, all of them are selected.
* Ties are broken towards nodes that appear earlier in the file's `nodes` list.

### Success response — `200 OK`

```json
{
  "selected": ["garissa_hub", "wajir_clinic"],
  "n": 2,
  "solver": "exact",
  "baseline_weighted_hours": 21.64326036705972,
  "optimized_weighted_hours": 11.544539568868093
}
```

| Field | Meaning |
|-------|---------|
| `selected` | **The answer:** ids of the `n` nodes to change, in the order they appear in the input. |
| `n` | Echo of the request (`selected` is shorter when `n` exceeded the number of upgradable nodes). |
| `solver` | `"exact"` or `"greedy"` — what actually ran. |
| `baseline_weighted_hours` | Objective with no upgrades. |
| `optimized_weighted_hours` | Objective after upgrading `selected`. |

### Error responses

Always JSON: `{ "error": "<human-readable message>" }`.

| Status | When |
|--------|------|
| `400 Bad Request` | Body is not valid multipart; no part named `file`; the file is not valid JSON / has wrong or unknown fields (including `departure_hours`) or unknown `kind`; `n` missing or not a non-negative integer; unknown `strategy`. (Query-string rejections are produced by the HTTP framework and may be plain text rather than JSON.) |
| `413 Payload Too Large` | Upload larger than `MEDROUTE_MAX_UPLOAD_BYTES`. |
| `422 Unprocessable Entity` | The file parsed but is not a valid network (bad coordinate/window/priority, missing opening window, `closed` with an opening window, solar window that does not contain the opening window, unknown node id in an edge, illegal or duplicate edge, dangling node, disconnected graph, zero total priority), or `n = 0`, or `strategy=exact` exceeds the combination limit. |
| `404` / `405` | Unknown path / wrong method. |
| `500` | Internal failure (worker panic). Should not happen. |

---

## `GET /health`

Returns `200 OK` with body `ok`.
