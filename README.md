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

## Running it on your machine

Needs Node 22+, pnpm and Docker (for Postgres and an S3-compatible store; Neon and R2 take their
place in production).

```sh
corepack enable
pnpm install
docker compose up -d                        # Postgres on 5432, file storage on 9090
cp .env.local.example apps/web/.env.local    # dev-only secrets, already filled in
pnpm --filter @immersia/db db:migrate        # create the tables
pnpm --filter @immersia/web dev              # http://localhost:3000
```

Sign in at `/sign-in`: with no mail server configured the magic link is printed in the terminal
running `dev`, after `[dev-mailbox]`. Open it to land in the studio, then make an event and open its
booth. A laptop camera is enough; the booth also has a simulated camera for when there is none.

`docker compose down` stops the containers and keeps the data; `down -v` throws it away. To run the
hourly sweep (expiry, cloud copies, cleanup) by hand:

```sh
curl -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire
```

Email, Google sign-in, Drive and Dropbox, the Live Display hub, Upstash rate limits and the server
render worker are all optional: without their keys the app runs and the screens that need one say so.
`.env.example` lists every variable.

## Working on it

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

### Analytics, the admin console and reports

Analytics are first-party and anonymous on guest pages: no third-party script, no cookie, no address or user agent
stored (a browser family at most). Events are defined once, as zod schemas, in `packages/shared/src/analytics.ts`.
The server records its own (`track()`); booths and Live Displays buffer theirs in the device database and flush
them to `POST /api/t` in batches with backoff (the studio posts its own); the server corrects each event's time
for the device's clock error and drops a retried batch's duplicates. A booth also reports `booth_session_started`
/ `booth_session_ended` and, on an uncaught error, `booth_crashed` (error name and a hash of the code location,
nothing else). To emit from new code, call `emitDeviceEvent`, `emitDisplayEvent` or `emitStudioEvent` from
`apps/web/src/lib/analytics-client.ts`, after adding the event to the catalogue and to `EVENT_SOURCES`.

`analytics_event` is partitioned by month. Inserts never fail for want of a partition (a default partition takes
the rest) and the hourly cron (`/api/cron/expire`) keeps the next months created. To drop old data:
`DROP TABLE analytics_event_pYYYYMM`.

`/admin` is for platform admins: set `ADMIN_EMAILS` (comma-separated, full addresses). It shows the six success
metrics against their targets over 30 or 90 days with a weekly trend, capture-to-QR by render path, render
failures, download success by route, storage per organization against the 50 GB fair-use ceiling, and
infrastructure cost per active operator from the monthly bill you enter there. `/admin/reports` is the reports
queue with its 24-hour clock. How reports, takedowns and hash matching work, and what is not covered, is in
[SECURITY.md](SECURITY.md#abuse-reports-takedown-and-hash-matching). Video hash matching needs a vendor and a
legal decision: the `MediaScanner` seam exists, and no scanner is connected.

## Principles

- **Nothing behind payment.** Costs are held down by design: on-device rendering, expiring guest files,
  zero-egress storage and bring-your-own cloud.
- **No clip is ever lost.** Every take is written to device storage before any processing.
- **One renderer.** Layout and video rendering are pure TypeScript and WebGL2, so preview, print, device and
  server output are identical.
- **Clean room.** We reproduce capabilities, not assets. Every template, effect, font and sound is original
  or openly licensed.
