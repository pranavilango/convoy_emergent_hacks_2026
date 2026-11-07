# Convoy

A preconfigured linear-time logistics analysis platform for SMEs to optimize scaling.

**Problem.** Imagine you are a local bakery trying to deliver cupcakes to more customers. You have
limited resources, so how you spend them is crucial. Existing software requires technical
knowledge, is expensive, and doesn't tell you what to do next.

**Solution.** Convoy is a growth planner built specifically for small businesses. Upload your
current network (locations, working hours, order sizes, and vehicles) and Convoy tells you which
practical changes will have the highest impact: where to open a new store, which neighbourhood to
expand delivery to, optimal working hours, and so on.

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

"Try the demo" opens a map editor. Search an address, give it a type (Factory, Warehouse, Retail
store, or your own) and its working hours, and it's pinned on the map as a colored square.
Connect locations to describe the network: select a square, press **Connect**, then click
destination squares (click again to unlink). You can also connect from the panel. Everything is
saved in the browser (`localStorage`, key `convoy.demo.v1`). Each visitor sees only their own
data, and clearing site data resets it.

The network is a directed graph, ready to hand to the planning engine later:

- **Locations** are the nodes. Each has `hours`: one list of `{ open, close }` ranges per day
  (`mon`–`sun`), in minutes since midnight. An empty list means closed. `close < open` runs past
  midnight, and `close: 1440` means "until midnight". Locations saved before hours existed have
  `hours: null`.
- **Connections** are the edges, stored as `{ id, fromId, toId }`. A connection only records that
  `fromId` links to `toId`: there's no distance or cost. A→B and B→A are separate connections.

- Page: `src/app/demo/page.tsx`. UI: `src/components/demo/`.
- State: `src/lib/demo/`. `reducer.ts` holds the rules, `graph.ts` the connection helpers,
  `hours.ts` working hours, and `store.ts` handles saving. Swap `store.ts` to move to a backend.

### Google Maps setup

1. In Google Cloud Console, enable **Maps JavaScript API** and **Places API (New)**, with billing
   on.
2. Create an API key. Restrict it to those two APIs and to these HTTP referrers:
   `http://localhost:3000/*`, plus your Vercel domains once deployed.
3. Create a **Map ID** (JavaScript, Vector) under Google Maps Platform → Map management.
4. Copy `.env.example` to `.env.local` and fill in both values, then restart `npm run dev`.

Without a key the demo still loads, shows how to configure it, and lets you manage types.

### Map style

Maps that use a Map ID are styled in Cloud Console, not in code. To apply the Convoy look:

1. Google Maps Platform → **Map styles** → **Create style** → **Import JSON**, and paste
   `docs/google-maps-style.json`.
2. Save, then attach the style to your Map ID (Map ID → select the style → Save).

It can take a few minutes to show up. Until then the map uses Google's default style.

## Deploying

Import the repository in Vercel. It detects Next.js automatically. Add
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` under Project → Settings →
Environment Variables, and add the Vercel domains to the key's referrer restrictions. Pushes to
`main` deploy to production, and other branches get preview URLs.
