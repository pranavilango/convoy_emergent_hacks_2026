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
- Tailwind CSS v4 (config in `src/app/globals.css`)
- Vitest + Testing Library
- Hosted on [Vercel](https://vercel.com)

## Development

Requires Node.js 20.9+.

```sh
npm install
npm run dev        # http://localhost:3000
```

| Script              | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Dev server with hot reload      |
| `npm run build`     | Production build                |
| `npm start`         | Serve the production build      |
| `npm run lint`      | ESLint (Next + Prettier rules)  |
| `npm run typecheck` | TypeScript, no emit             |
| `npm test`          | Run tests once                  |
| `npm run format`    | Format everything with Prettier |

## Demo (`/demo`)

"Try the demo" opens a map editor for a medical supply network. Search an address and add it as a
**port** (sea or air), **warehouse**, or **clinic** (with the population it serves); it's pinned
on the map as a colored square marked P, W, or C. Warehouses and clinics get working hours (the grid, the region, and staffing all vary); ports are
always open. Connect sites to show how supplies flow: select a port or warehouse, press
**Connect**, then click the sites it supplies (click again to unlink). You can also connect from
the panel. Everything is saved in the browser (`localStorage`, key `convoy.demo.v2`). Each visitor
sees only their own data, and clearing site data resets it.

The network is a directed graph, ready to hand to the allocation engine:

- **Locations** are the nodes, each with a `kind`: `port`, `warehouse`, or `clinic`. Ports have
  `portMode` `"sea"` or `"air"` (null for other kinds). `hours` is one list of `{ open, close }`
  ranges per day (`mon`–`sun`), in minutes since midnight. An empty list means closed,
  `close < open` runs past midnight, and `close: 1440` means "until midnight". Ports are always
  24/7. Clinics have `population`, the number of people they serve (a whole number from 1 to
  100,000,000); it's null for other kinds, and for a clinic until it's set.
- **Connections** are the edges, stored as `{ id, fromId, toId }`. Supplies flow one way, so the
  only allowed links are port → warehouse and warehouse → clinic (no loops, nothing backwards,
  no skipping a step). Changing a site's type removes links that no longer fit, after asking.
- **Distance** isn't stored: it's the straight-line (great-circle) distance between the two ends,
  from `distanceKm()` in `geometry.ts`, so it's always in step with the locations.

Data saved by the earlier version of the demo (factories, retail stores, `convoy.demo.v1`) is
discarded on load.

- Page: `src/app/demo/page.tsx`. UI: `src/components/demo/`.
- State: `src/lib/demo/`. `kinds.ts` defines the three kinds and the supply rule, `reducer.ts`
  enforces it, `graph.ts` has the connection helpers, `hours.ts` working hours, `population.ts`
  clinic population, `geometry.ts` distance and marker sizing, and `store.ts` handles saving.
  Swap `store.ts` to move to a backend.

### Google Maps setup

1. In Google Cloud Console, enable **Maps JavaScript API** and **Places API (New)**, with billing
   on.
2. Create an API key. Restrict it to those two APIs and to these HTTP referrers:
   `http://localhost:3000/*`, plus your Vercel domains once deployed.
3. Create a **Map ID** (JavaScript, Vector) under Google Maps Platform → Map management.
4. Copy `.env.example` to `.env.local` and fill in both values, then restart `npm run dev`.

Without a key the demo still loads, shows how to configure it, and lists the location types.

### Solar allocation analysis

On `/demo`, add at least one port, warehouse, and clinic to enable **Analyze**. The button opens a
popup while the server makes two Gemini calls through the Google AI Studio API: the first generates
a temporary JSON response recommending exactly two warehouses or clinics to make open 24/7, with
estimated supply wait times before and after; the second explains those recommendations. The popup
shows the sites, wait-time estimates, and analysis.

Wait times are hypothetical AI estimates, not measured outcomes. The demo does not collect supply
wait-time records, staffing, demand, or operating costs, so validate recommendations against real
planning data before acting on them.

The server-side endpoint accepts the current network:

```http
POST /api/solar-allocation
Content-Type: application/json

{
  "network": {
    "locations": [
      { "id": "clinic-1", "name": "Clinic A", "kind": "clinic", "portMode": null }
    ],
    "connections": []
  }
}
```

The response contains the generated `allocation` JSON and its `analysis`. The allocation has a
`recommendations` array with exactly two entries, each including a `locationId`, `locationName`,
`kind` (`warehouse` or `clinic`), `estimatedWaitHoursBefore`, `estimatedWaitHoursAfter`, and
`rationale`. Wait-time values are hours. Set `GEMINI_API_KEY` in
`.env.local` for local development and in the Vercel project environment for deployment. The key
must not use a `NEXT_PUBLIC_` prefix. Both calls default to `gemini-3.5-flash-lite`; set
`GEMINI_MODEL` if your AI Studio project uses a different available model. Network details are sent
to Google's Gemini API for generation and analysis.

### Map style

The demo map is Google's flat road map in its built-in **dark** color scheme, set in code
(`colorScheme={ColorScheme.DARK}` in `src/components/demo/map-view.tsx`). There's nothing to
configure in Cloud Console. Leave your Map ID without a custom style attached, or that style's
look is used instead.

## Deploying

Import the repository in Vercel. It detects Next.js automatically. Add
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` under Project → Settings →
Environment Variables, and add the Vercel domains to the key's referrer restrictions. Pushes to
`main` deploy to production, and other branches get preview URLs.
