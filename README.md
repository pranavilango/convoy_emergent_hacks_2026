# Convoy

A solar power allocation planner for medical warehouses and clinics in low-resource regions.

**Problem.** A rural clinic keeps vaccines and insulin in a fridge that runs on a grid that keeps
cutting out, so it can only take in medicines while it's both staffed and powered. Solar power
fixes that, but budgets cover a few sites, never all of them, and today they go to whoever asks
first rather than where they protect the most care.

**Solution.** Convoy maps a medical supply network (the ports supplies arrive through, the
warehouses that store them, and the clinics that use them) and decides where solar power does the
most good. It weighs how supplies flow between sites, how far they travel, when each site is
staffed, and when it has grid power, then says which sites to give solar first, how much that
shortens deliveries for the people they serve, and why (explained by Gemini).

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- Rust `medroute` allocation engine, compiled to WebAssembly and run inside the app (also
  available as an optional Axum HTTP service)
- Google Maps JavaScript API + Places API (New) for the map and address search
- Gemini (`gemini-3.5-flash-lite` by default) to explain each plan
- Tailwind CSS v4 (config in `src/app/globals.css`)
- Vitest + Testing Library
- Hosted on [Vercel](https://vercel.com)

## Development

Requires Node.js 20.9+.

```sh
npm install
npm run dev        # http://localhost:3000
```

| Script                 | What it does                     |
| ---------------------- | -------------------------------- |
| `npm run dev`          | Dev server with hot reload       |
| `npm run dev:engine`   | Optional Rust HTTP service       |
| `npm run build:engine` | Rebuild the embedded Rust engine |
| `npm run build`        | Production build                 |
| `npm start`            | Serve the production build       |
| `npm run lint`         | ESLint (Next + Prettier rules)   |
| `npm run typecheck`    | TypeScript, no emit              |
| `npm test`             | Run tests once                   |
| `npm run format`       | Format everything with Prettier  |

## Landing page (`/`)

A dark page: black at the top, deepening into the navy of the Earth photo, which fades back out
to black below it. Text is white, with aquamarine for what matters most ("Convoy", "Every kilowatt
counts.", the solution's key phrase, "Power care.", and links). The hero's headline powers on like
lights on a weak grid coming back: "Convoy" first, then "Power Planner" and the outputs at uneven
moments, all within about 1.5s, each glowing in its own colour. Further down, "Every kilowatt
counts." and the footer's "Power care." flicker on as they scroll into view. The Earth photo turns
as it scrolls past: it rotates (±3°) about the planet's real centre, fitted from the horizon in
the photo, so the horizon stays put while the land and lights slide along it (CSS scroll-driven
animation, `.earth-spin`; browsers without it show the photo still). With reduced motion turned
on, nothing flickers or turns. The nav links glide smoothly to their sections. The logo mark is
aquamarine, matching the site's accent color.

- Flicker: `power-on` keyframes in `src/app/globals.css`; `lightsOn()` in `src/app/page.tsx` sets
  the hero timings, and `src/components/landing/power-on.tsx` plays it on scroll.
- Colours: `night`, `night-navy`, and `aqua` tokens in `src/app/globals.css`.

## Demo (`/demo`)

The demo uses the same night theme: `.theme-night` (in `src/app/globals.css`) on the demo's root
turns its `background`/`foreground` tokens black and white, with aquamarine for primary actions
and "on" states.

"Try the demo" opens a map editor for a medical supply network: the map on the right, and an
editor column on the left that runs in the order you'd fill it in:

1. **Budget** — what one solar unit costs and the total to spend. This is the main limit: the
   panel shows how many whole units it covers, and that's how many sites the optimizer picks.
2. **Add a location** — search an address and add it as a **port** (sea or air), **warehouse**,
   or **clinic** (with the population it serves). Warehouses and clinics also get working hours
   and **grid power** hours (all day, or one daily window such as 08:00–16:00 where power is
   rationed); a note under the power hours says when the site can take in medicines today and
   with solar. Ports are always open.
3. **Location types** — the three kinds, how many of each are on the map, and how supplies flow
   (port → warehouse → clinic). Drag a type onto the map to drop a new site at that exact point,
   or click (tap, or press Enter on) a type and then click the map. The site shows as a dashed
   square while the Add a location form opens with its coordinates and type filled in; add its
   name, hours, grid power, and population there, and it's saved at exactly that point (the
   coordinates are what the engine gets). Escape or **Cancel** stops placing; **Change** discards
   the dropped point.
4. **Locations** — every site; open one to rename it or change its type, hours, grid power, or
   population. The red bin on each row deletes a site and its links in one click; so does
   **Delete** on a site's map card. Either way, a "Deleted … · Undo" notice stays up for 8
   seconds, and **Undo** puts the site and its links back exactly where they were.
5. **Connections** — who supplies whom. Add links here, or select a port or warehouse on the map,
   press **Connect**, then click the sites it supplies (click again to unlink).
6. **Analysis** — what's still missing, then **Analyze**.

Sites are pinned on the map as colored squares marked P, W, or C. A warehouse or clinic that never
has grid power while it's staffed (so it can't take in medicines at all today) is drawn in black
and white, letter and all, with a "No power while staffed" row in the legend. After an analysis,
the sites chosen for solar glow with an aquamarine ring until the network changes; a black and
white site that's chosen powers back on in its colour, and one that isn't stays black and white.

On desktop the page fills the window and only the editor column scrolls (phones stack the map
above the editor and scroll normally). Everything is saved in the browser (`localStorage`, key
`convoy.demo.v2`). Each visitor sees only their own data, and clearing site data resets it.

On a first visit a short tooltip tour explains each part, right next to it, with a thin outline
around the part it's on. It doesn't dim or block the page. Skip or Escape ends it, the arrow keys
step through it, and the aqua-outlined **Tour** button in the header replays it. Having seen it is
remembered in `localStorage` (key `convoy.tour.v1`). The stops are in `guided-tour.tsx`; each part
they point at is marked `data-tour`.

### Ghana sample network

The floating **Load Ghana sample network** button (bottom right) fills in a ready-made corridor
for a live demo (`src/lib/demo/sample-network.ts`). It replaces the network and budget saved in
that browser, asking first if there's already a network on the map. It has seven sites, one
supply chain from Tema Port through two warehouses to four clinics, on a rationed grid where each
site has power at different hours:

| Site                     | Supplied by              | Staffed               | Grid power  | Serves  |
| ------------------------ | ------------------------ | --------------------- | ----------- | ------- |
| Tema Port                | —                        | 24/7                  | —           | —       |
| Accra Medical Warehouse  | Tema Port                | Mon–Sat 07:00–19:00   | 06:00–18:00 | —       |
| Kumasi Medical Warehouse | Tema Port                | Every day 06:00–22:00 | 10:00–18:00 | —       |
| Korle Bu Clinic          | Accra Medical Warehouse  | 24/7                  | 06:00–18:00 | 450,000 |
| Cape Coast Clinic        | Accra Medical Warehouse  | Every day 08:00–17:00 | 07:00–19:00 | 280,000 |
| Komfo Anokye Clinic      | Kumasi Medical Warehouse | 24/7                  | 14:00–22:00 | 620,000 |
| Tamale Clinic            | Kumasi Medical Warehouse | Every day 08:00–20:00 | 16:00–24:00 | 390,000 |

The budget is $36,000 at $12,000 a unit, so **3 solar units**. Analyze puts them on **Kumasi
Medical Warehouse**, **Komfo Anokye Clinic**, and **Tamale Clinic**, cutting the
population-weighted wait for supplies from about **10.3 h to 6.9 h** (a third shorter) across
1,740,000 people. Each unit helps, by less each time: 1 unit → 9.3 h, 2 → 7.8 h, 3 → 6.9 h. Cape
Coast's power already covers its staffed hours, so solar wouldn't change anything there. (The
figures come from the engine and are the same every run; Gemini's wording varies.)

### Data model

The network is a directed graph, ready to hand to the allocation engine:

- **Locations** are the nodes, each with a `kind`: `port`, `warehouse`, or `clinic`. Ports have
  `portMode` `"sea"` or `"air"` (null for other kinds). `hours` is one list of `{ open, close }`
  ranges per day (`mon`–`sun`), in minutes since midnight. An empty list means closed,
  `close < open` runs past midnight, and `close: 1440` means "until midnight". Ports are always
  24/7. `gridPower` is `{ from, until }` in whole hours (0–24, the same every day), or null for a
  reliable grid (and always for ports); the same start and end hour (e.g. `{ from: 8, until: 8 }`)
  means no grid power at all, which the **No grid power at all** checkbox sets. Clinics have `population`, the number of people they serve
  (a whole number from 1 to 100,000,000); it's null for other kinds, and for a clinic until it's
  set.
- **Connections** are the edges, stored as `{ id, fromId, toId }`. Supplies flow one way, so the
  only allowed links are port → warehouse and warehouse → clinic (no loops, nothing backwards,
  no skipping a step). Changing a site's type removes links that no longer fit, after asking.
- **Budget** is stored as `budget: { unitCost, total }`: what one solar power unit costs and the
  total money available, in US dollars (positive, at most two decimal places), or `null` until
  entered. The number of whole units it covers is sent to the Rust allocator as the number of
  sites to upgrade.
- **Distance** isn't stored: it's the straight-line (great-circle) distance between the two ends,
  from `distanceKm()` in `geometry.ts`, so it's always in step with the locations.

Data saved by the earlier version of the demo (factories, retail stores, `convoy.demo.v1`) is
discarded on load.

- Page: `src/app/demo/page.tsx`. UI: `src/components/demo/`.
- State: `src/lib/demo/`. `kinds.ts` defines the three kinds and the supply rule, `reducer.ts`
  enforces it, `graph.ts` has the connection helpers, `hours.ts` working hours, `power.ts` grid
  power and when a site can take in medicines, `sample-network.ts` the Ghana sample,
  `population.ts` clinic population, `budget.ts` the solar budget, `geometry.ts` distance and
  marker sizing, `tour.ts` whether the tour is showing, and `store.ts` handles saving.

### Rust allocation service

The allocator is the Rust library in `src/lib.rs`. The app runs it **inside its own API route**,
compiled to WebAssembly, so Analyze works locally and on Vercel with no separate service and no
Rust needed to run the site:

- `medroute-wasm/` wraps the library's `analyze_bytes` in a tiny import-free WebAssembly ABI.
- `npm run build:engine` compiles it and embeds it in `src/lib/solar-allocation/engine-binary.ts`
  (generated; commit it). Run this after any change to the Rust engine. It needs Rust from
  [rustup.rs](https://rustup.rs) plus `rustup target add wasm32-unknown-unknown`.
- `src/lib/solar-allocation/engine.ts` loads and runs it; results match the HTTP API exactly.

The original HTTP service still works (contract in [API.md](API.md)): run it with
`npm run dev:engine` (`cargo run --release`) and set `MEDROUTE_API_URL` (for example
`http://127.0.0.1:8080`) to have the route call it instead. Leave `MEDROUTE_API_URL` unset to use
the built-in engine. The HTTP server is the crate's default `server` feature; the WebAssembly
build uses the library without it.

### Google Maps setup

1. In Google Cloud Console, enable **Maps JavaScript API** and **Places API (New)**, with billing
   on.
2. Create an API key. Restrict it to those two APIs and to these HTTP referrers:
   `http://localhost:3000/*`, plus your Vercel domains once deployed.
3. Create a **Map ID** (JavaScript, Vector) under Google Maps Platform → Map management.
4. Copy `.env.example` to `.env.local` and fill in both values, then restart `npm run dev`.

Without a key the demo still loads, shows how to configure it, and lists the location types.

### Solar allocation analysis

**Analyze** unlocks once nothing the engine would reject is left. Until then the Analysis section
lists what's missing, by site name (`src/lib/solar-allocation/readiness.ts`): at least one port,
warehouse, and clinic; every site linked into one network; warehouses and clinics open at least
one day, with no overnight shifts; at least one site that loses power during its working hours
(otherwise solar would change nothing); a population for every clinic; and a budget that covers
at least one unit.

A site's power hours never block Analyze. A site can only take in medicines while it's staffed and
has power to keep them cold, so its window today is its staffed hours (one daily span, from the
earliest opening to the latest closing across the week) narrowed to its grid power hours. Solar
lifts the power limit, so its window with solar is the staffed span. The engine gets both
(`open_from`/`open_until` and `solar_open_from`/`solar_open_until`, see [API.md](API.md)). A site
that's staffed and powered for only an hour is modelled with that one hour. One that's never
powered while staffed is sent as `closed`: it stays in the network, and every delivery to it counts
as a full day's wait (24 h, longer than any open site can cause). That makes it the worst off, so
a big clinic in that state is near the top of the list for solar, which opens it for its staffed
hours.

The Next.js server sends the network and the budget's unit count to the Rust optimizer, which
picks the sites. It also asks for the best sites at every smaller budget (1, 2, … units, up to
10), which the popup charts and Gemini gets as context. Gemini receives the result and the network's facts (staffed
hours, grid power, when each site takes in medicines today and with solar, people served, supply
links and distances) and explains the choice in short bullets; it never chooses sites or suggests
other allocations. The result popup shows:

- **Estimated impact** — people served by all clinics, hours saved per person, the combined
  people-hours, and the population-weighted wait before → after;
- **Chosen for solar** — each chosen site: when it takes in medicines today → with solar (or
  "Can't take in medicines today"), its staffed and grid power hours, people served, and its
  supplier and distance;
- **Why these sites** — Gemini's explanation;
- **Each extra solar unit** — a thin line chart of the population-weighted wait with no solar and
  with the engine's best sites for 1, 2, … units (from the route's `steps`), labelled at its ends;
  hovering or focusing a point names its sites, and a hidden table gives screen readers the same
  numbers (`budget-curve.tsx`);
- what the model assumes. The weighted times are model estimates, not measured outcomes: travel is
  a straight line at 60 km/h, and clinics count by the people they serve. Validate them against
  real operations data before acting on the recommendations.

The route is public and every new analysis calls Gemini, so it's protected
(`src/lib/solar-allocation/guard.ts`): each IP gets 30 analyses per 10 minutes and each server
instance 300 per hour (then `429` with `Retry-After`), and a network analyzed in the last hour is
answered from cache, instantly and without counting. Limits are per instance; for a hard global cap
also add a rate-limit rule in Vercel's Firewall.

The route (`POST /api/solar-allocation`) accepts a positive integer `n` and a `network` with site
coordinates, weekly hours, grid power, clinic population, and directed connections. It converts
these into the engine's graph format (see [API.md](API.md)) and runs the built-in engine, or, when
`MEDROUTE_API_URL` is set, uploads it as a JSON `file` to that service's
`POST /api/analyze?n=<n>&strategy=auto`. It returns the `allocation` (`selected`, `n`, `solver`,
`baseline_weighted_hours`, `optimized_weighted_hours`), the best sites for each smaller budget
(`steps`), and Gemini's `analysis`.

Set `GEMINI_API_KEY` in `.env.local` for local development and in the production environment.
`GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. `MEDROUTE_API_URL` is optional (see above).

### Map style

The demo map is Google's flat road map in its built-in **dark** color scheme, set in code
(`colorScheme={ColorScheme.DARK}` in `src/components/demo/map-view.tsx`). There's nothing to
configure in Cloud Console. Leave your Map ID without a custom style attached, or that style's
look is used instead.

## Deploying

Import the repository in Vercel. It detects Next.js automatically. Add
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` under Project Settings, and
add the Vercel domains to the key's referrer restrictions. Set `GEMINI_API_KEY` (and optionally
`GEMINI_MODEL`) in Vercel's server-side environment variables. The Rust allocator ships inside the
app, so nothing else needs deploying; leave `MEDROUTE_API_URL` unset on Vercel (if it's set to a
localhost address there, Analyze can't reach it). Pushes to `main` deploy to
production, and other branches get preview URLs.
