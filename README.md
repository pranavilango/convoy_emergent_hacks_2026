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

## Deploying

Import the repository in Vercel. It detects Next.js automatically, so no extra configuration is
needed. Pushes to `main` deploy to production, and other branches get preview URLs.
