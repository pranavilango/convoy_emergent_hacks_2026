# Agent notes

Convoy is a Next.js 16 (App Router) + React 19 + TypeScript site, styled with Tailwind CSS v4,
hosted on Vercel. npm is the package manager (`package-lock.json` is the lockfile).

## Layout

- `src/app/` — routes. `layout.tsx` (html shell, fonts, default metadata), `page.tsx` (landing
  page), `not-found.tsx`, `error.tsx`, `globals.css` (Tailwind entry + design tokens).
- `src/assets/` — images imported statically into components (use `next/image`).
- `src/lib/utils.ts` — `cn()` helper for shadcn/ui.
- `src/test/` — Vitest + Testing Library. `setup.ts` mocks `next/image`.

## Conventions

- Components are Server Components by default. Add `"use client"` only to files that need state,
  effects, event handlers, or browser APIs, and keep those files as small leaves.
- Every page exports its own `metadata`. Don't add `openGraph.images` to the root layout.
- Design tokens live in `src/app/globals.css`: oklch colors on `:root`/`.dark`, mapped to Tailwind
  utilities in `@theme inline`. Add a new color by defining `--name` and registering
  `--color-name: var(--name)`.
- Fonts come from `next/font/google` in `layout.tsx` as CSS variables; reference them from the
  `--font-*` tokens in `globals.css`. Never `@import` remote CSS.
- shadcn/ui is configured (`components.json`, `rsc: true`) but no components are installed. Add
  them with `npx shadcn@latest add <name>`.
- Secrets go in Vercel project env vars / `.env.local` (gitignored), never in the repo. Only
  `NEXT_PUBLIC_*` vars reach the browser.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before committing.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
