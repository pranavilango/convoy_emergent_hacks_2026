# Convoy

A solar power allocation planner for medical warehouses and clinics in low-resource regions.

**Problem.** A rural clinic keeps vaccines and insulin in a fridge that runs on a grid that keeps
cutting out. Solar panels and batteries fix that, but budgets cover a few sites, never all of them,
and today they go to whoever asks first rather than where they protect the most care.

**Solution.** Convoy maps a medical supply network (the ports supplies arrive through, the
warehouses that store them, and the clinics that use them) and decides where solar power does the
most good. It weighs how supplies flow between sites, how far they travel, and when each site is
staffed and needs power, then says which sites to equip first and what to give them.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- Rust `medroute` allocation service (Axum)
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

"Try the demo" opens a map editor for a medical supply network. The editor column runs in the
order you'd fill it in: **01 Budget** (the main limit), **02 Add a location**, **03 Location
types**, **04 Locations**, **05 Connections**, **06 Analysis**. On desktop the page fills the
window and only that column scrolls. A floating **Load Ghana sample network** button (bottom right)
fills in a ready-made corridor for a demo, asking first if it would replace a network.

On a first visit a short tooltip tour explains each part, right next to it, with a thin outline
around the part it's on. It doesn't dim or block the page. Skip or Escape ends it, the arrow keys
step through it, and the header's **Tour** button replays it. Having seen it is remembered in
`localStorage` (key `convoy.tour.v1`). The stops are in `guided-tour.tsx`; each part they point at
is marked `data-tour`.

Search an address and add it as a
**port** (sea or air), **warehouse**, or **clinic** (with the population it serves); it's pinned
on the map as a colored square marked P, W, or C. Warehouses and clinics get working hours and
**grid power** hours (all day, or one daily window such as 08:00–16:00 where power is rationed);
ports are always open. Connect sites to show how supplies flow: select a port or warehouse, press
**Connect**, then click the sites it supplies (click again to unlink). You can also connect from
the panel. Everything is saved in the browser (`localStorage`, key `convoy.demo.v2`). Each visitor
sees only their own data, and clearing site data resets it.

Use **Load Ghana sample network** for a prebuilt seven-site scenario and a $24,000 budget. Loading
the sample replaces the network and budget currently saved in that browser.

The network is a directed graph, ready to hand to the allocation engine:

- **Locations** are the nodes, each with a `kind`: `port`, `warehouse`, or `clinic`. Ports have
  `portMode` `"sea"` or `"air"` (null for other kinds). `hours` is one list of `{ open, close }`
  ranges per day (`mon`–`sun`), in minutes since midnight. An empty list means closed,
  `close < open` runs past midnight, and `close: 1440` means "until midnight". Ports are always
  24/7. `gridPower` is `{ from, until }` in whole hours (0–24, the same every day), or null for a
  reliable grid (and always for ports). Clinics have `population`, the number of people they serve (a whole number from 1 to
  100,000,000); it's null for other kinds, and for a clinic until it's set.
- **Connections** are the edges, stored as `{ id, fromId, toId }`. Supplies flow one way, so the
  only allowed links are port → warehouse and warehouse → clinic (no loops, nothing backwards,
  no skipping a step). Changing a site's type removes links that no longer fit, after asking.
- **Budget** is stored as `budget: { unitCost, total }`: what one solar power unit costs and the
  total money available, in US dollars (positive, at most two decimal places), or `null` until
  entered. The panel shows how many whole units the budget covers. That count is sent to the Rust
  allocator as the number of sites to upgrade.
- **Distance** isn't stored: it's the straight-line (great-circle) distance between the two ends,
  from `distanceKm()` in `geometry.ts`, so it's always in step with the locations.

Data saved by the earlier version of the demo (factories, retail stores, `convoy.demo.v1`) is
discarded on load.

- Page: `src/app/demo/page.tsx`. UI: `src/components/demo/`.
- State: `src/lib/demo/`. `kinds.ts` defines the three kinds and the supply rule, `reducer.ts`
  enforces it, `graph.ts` has the connection helpers, `hours.ts` working hours, `power.ts` grid
  power and when a site can take in medicines, `sample-network.ts` the Ghana sample, `population.ts`
  clinic population, `budget.ts` the solar budget, `geometry.ts` distance and marker sizing, and
  `store.ts` handles saving.

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

Before Analyze unlocks, the panel lists anything the engine would reject, by site name: unlinked
sites, separate networks, sites closed all week or with overnight shifts, a network with no power
cuts at all (solar would change nothing), clinics without a population, or a budget below one unit
(`src/lib/solar-allocation/readiness.ts`). A site's power hours never block Analyze: a site that's
staffed and powered for only an hour is modelled with that one hour, and one that's never powered
while staffed (it can't take in medicines at all today) is sent to the engine as `closed`, where
every delivery to it counts as a full day's wait. That makes it the worst off, so a big clinic in
that state is near the top of the list for solar, which opens it for its staffed hours. A result shows the drop in population-weighted wait,
each chosen site (when it takes in medicines today → with solar, people served, supply link), what each extra solar unit buys (the route also asks the engine for the best 1, 2, … units,
up to 10), and Gemini's plain-language explanation built from those facts. Chosen sites glow on
the map until the network changes.

### Google Maps setup

1. In Google Cloud Console, enable **Maps JavaScript API** and **Places API (New)**, with billing
   on.
2. Create an API key. Restrict it to those two APIs and to these HTTP referrers:
   `http://localhost:3000/*`, plus your Vercel domains once deployed.
3. Create a **Map ID** (JavaScript, Vector) under Google Maps Platform → Map management.
4. Copy `.env.example` to `.env.local` and fill in both values, then restart `npm run dev`.

Without a key the demo still loads, shows how to configure it, and lists the location types.

### Solar allocation analysis

On `/demo`, add at least one port, warehouse, and clinic, then set a budget that covers at least one
solar unit to enable **Analyze**. The Next.js server sends the graph and budget-derived unit count to
the Rust optimizer. Gemini receives the backend result and network details to explain the selection;
it does not choose sites or generate alternative allocations. The popup shows selected sites,
weighted delivery-time metrics, and Gemini's explanation.

The weighted times are model estimates, not measured outcomes. The optimizer uses coordinates for
transit time, opening windows for waiting time, and clinic population as a weight. A site can only
take in medicines while it's staffed and has power to keep them cold, so its window today is its
staffed hours (one daily span, from the earliest opening to the latest closing across the week)
narrowed to its grid power hours. Solar lifts the power limit, so its window with solar is the
staffed span; the engine gets both (`open_from`/`open_until` and `solar_open_from`/
`solar_open_until`, see [API.md](API.md)). Validate the model against real operations data before
acting on its recommendations.

The route is public and every new analysis calls Gemini, so it's protected
(`src/lib/solar-allocation/guard.ts`): each IP gets 30 analyses per 10 minutes and each server
instance 300 per hour (then `429` with `Retry-After`), and a network analyzed in the last hour is
answered from cache, instantly and without counting. Limits are per instance; for a hard global cap
also add a rate-limit rule in Vercel's Firewall.

The Next.js route accepts a positive integer `n` and a `network` containing site coordinates,
weekly hours, grid power, clinic population, and directed connections. It converts these into the Rust graph
format and uploads a JSON `file` to `POST /api/analyze?n=<n>&strategy=auto`; see [API.md](API.md)
for the backend contract. The response has `selected`, `n`, `solver`, `baseline_weighted_hours`, and
`optimized_weighted_hours`; the API route returns that allocation with Gemini's `analysis`.

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
