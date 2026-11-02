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

### Guest file storage

Guest files live in any S3-compatible bucket (Cloudflare R2 in production, S3Mock in CI); see the
`S3_*` variables in `.env.example`. Booths upload straight to the bucket with presigned URLs, and the
share page's "Save to Photos" fetches from it, so the bucket needs a CORS rule for the app's origin:

```json
[
  {
    "AllowedOrigins": ["https://your-app-origin"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Expired sessions are swept hourly by Vercel Cron (`apps/web/vercel.json`, authorised by `CRON_SECRET`).

### Bring-your-own cloud (Google Drive and Dropbox)

An operator can have every finished file copied to their own Drive or Dropbox as well. The booth uploads
once, to the bucket above; the server then streams each file from there to the operator's cloud (8 MiB parts,
so memory stays flat for any size), into `<folder>/<Event name YYYY-MM-DD>/`. Guests still use the hosted
share page. Nothing is deleted from the bucket, a failed or revoked connection only pauses the copies (they
resume, without duplicates, after reconnecting), and the retries run from the hourly cron.

It is off until the server has a token key and credentials (the Integrations screen shows "not configured"):

- `INTEGRATION_TOKEN_KEY`: `openssl rand -base64 32`. Encrypts the refresh tokens (AES-256-GCM) in the database.
- Google Drive: a Web-application OAuth client with the redirect URI
  `{origin}/api/integrations/drive/callback`, using only the `drive.file` scope (Immersia sees only what it
  creates). `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET`, or the sign-in `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` if that client also lists the Drive redirect URI. While the OAuth consent screen is in
  "Testing", Google expires refresh tokens after 7 days; publish it to avoid re-authorising weekly.
- Dropbox: an app with access type "App folder", the redirect URI `{origin}/api/integrations/dropbox/callback`
  and the scopes `account_info.read`, `files.metadata.read`, `files.metadata.write`, `files.content.write`.
  `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`.

## Principles

- **Nothing behind payment.** Costs are held down by design: on-device rendering, expiring guest files,
  zero-egress storage and bring-your-own cloud.
- **No clip is ever lost.** Every take is written to device storage before any processing.
- **One renderer.** Layout and video rendering are pure TypeScript and WebGL2, so preview, print, device and
  server output are identical.
- **Clean room.** We reproduce capabilities, not assets. Every template, effect, font and sound is original
  or openly licensed.
