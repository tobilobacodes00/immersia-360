# Immersia 360

A free, browser-based 360 video booth and photo-strip booth. No paywall, no watermark, unlimited devices on
one account. It runs on any laptop, tablet or phone with a modern browser and installs as a PWA.

The product requirements are in the PRD (_Immersia 360 — Product Requirements Document_, 15 Oct 2026). The
visual design comes from the Immersia Booth app (`booth-by-immersia`): light and editorial, paper and ink
with one cobalt accent.

## Layout

| Path              | What it is                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Next.js 16 app: operator console, booth, kiosk, Live Display, guest pages, API                                |
| `packages/ui`     | Design system ported from Immersia Booth (tokens, kit, guest components)                                      |
| `packages/shared` | IDs and short codes, the token language, event and template schemas, colour/contrast, routes, analytics types |
| `packages/db`     | Drizzle schema and migrations (Neon Postgres)                                                                 |
| `packages/i18n`   | English, Spanish and Portuguese message catalogues                                                            |

These arrive in later milestones: `apps/realtime` (Durable Objects hub), `apps/render-worker` (server
render fallback), `packages/render-engine`, `packages/effects`, `packages/layout`, `packages/capture`,
`packages/offline`.

## Working on it

```sh
corepack enable
pnpm install
cp .env.example apps/web/.env.local   # fill in what you need
pnpm --filter @immersia/web dev
```

Verification runs in CI: lint, types, unit tests, Playwright on Chrome and WebKit, and axe accessibility
checks. Every PR also gets a Vercel preview with its own Neon database branch.

## Principles

- **Nothing behind payment.** Costs are held down by design: on-device rendering, expiring guest files,
  zero-egress storage and bring-your-own cloud.
- **No clip is ever lost.** Every take is written to device storage before any processing.
- **One renderer.** Layout and video rendering are pure TypeScript and WebGL2, so preview, print, device and
  server output are identical.
- **Clean room.** We reproduce capabilities, not assets. Every template, effect, font and sound is original
  or openly licensed.
