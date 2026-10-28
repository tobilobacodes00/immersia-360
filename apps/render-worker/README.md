# @immersia/render-worker

The last rung of the booth's render ladder (`local` → `wasm` → **`server`**): when a booth's browser can
neither encode H.264 nor run the WebAssembly encoder, the take is rendered here instead, by headless
Chrome running **the same `render()`** from `@immersia/render-engine`, through the same WebGL2 compositor
and shaders (look, effects, background, overlay, cards) and the same H.264 encode. Nothing is
reimplemented: the recipe the booth sends is turned back into the `RenderJob` the booth would have built
(`page/render-page.ts`), and `render()` does the rest.

```
booth ──(1) uploads the take's original, the drawn overlay and end card ──▶ storage (presigned PUTs)
booth ──(2) POST /api/booth/takes/:id/render {sessionId, recipe} ─────────▶ web app   ─▶ server_render_job (queued)
web app ─(3) Fly Machines API: start the worker machine (no-op when unset)
worker ──(4) POST /api/render-worker/claim ───────────────────────────────▶ web app   (lease + recipe + download URLs)
worker ──(5) downloads the files, renders in Chrome, ──(6) outputs ──▶ presigned PUTs ──(7) complete
web app ─▶ the outputs land in the guest's session exactly like a booth's uploads: share page, gallery,
           Live Display and cloud copies pick them up unchanged. The booth only polls the job.
```

The guest's QR flow is unchanged: the session page shows "Your files are on their way" until the outputs
land, whichever rung rendered them.

## Authentication between the worker and the web app: a shared secret

Worker-only endpoints (`/api/render-worker/*`) take `Authorization: Bearer <RENDER_WORKER_SECRET>`,
compared in constant time (`isRenderWorker`). With no secret configured the whole server rung is off and
every worker request is refused. Chosen over giving the worker database access because:

- the worker needs no database or storage credentials at all: it gets short-lived presigned URLs for
  exactly one job's files, and nothing else;
- the job state machine (claim, lease, retries, quotas, publishing outputs, analytics) lives in one place,
  the web app, and is unit-tested there (`apps/web/src/server/render-jobs-core.ts`);
- the worker can run anywhere (Fly, a long-lived container, a laptop) with two environment variables.

A claim also hands out a per-claim token; heartbeat, outputs, complete and fail all require it, so a worker
whose lease lapsed (and whose job was given to another) can not finish the job a second time.

## The queue

Rows of `server_render_job` are the queue, in the house style of the cloud copy queue
(`apps/web/src/server/cloud/copy.ts`): a claim with `FOR UPDATE SKIP LOCKED`, and a lease kept in a
timestamp column (`next_attempt_at`: while `queued` the earliest claim time, while `running` when the lease
ends). A worker extends its lease every minute (`RENDER_HEARTBEAT_MS`); one that dies is noticed after at
most five minutes and its job is claimed again. Tries are capped at 3, with backoff of 1, 4 and 16 minutes.
Failure codes (`SERVER_RENDER_ERRORS` in `@immersia/shared`): `undecodable`, `unsupported_encoder`,
`source_missing` and `invalid_recipe` are permanent; the rest (`encoder_stall`, `gpu`, `download_failed`,
`upload_failed`, `timeout`, `lease_lost`, `shutdown`, `failed`) retry. A render that runs past 45 minutes is
stopped by the server whatever the heartbeats say.

Limits (server renders cost money per render): per event 60 an hour and 500 in all, per organization 1000
a day; `SERVER_RENDER_LIMIT_EVENT_HOURLY`, `SERVER_RENDER_LIMIT_EVENT_TOTAL` and
`SERVER_RENDER_LIMIT_ORG_DAILY` on the web app change them. A refused request answers `429`
`render_rate_limited` with the limit that was hit and a `Retry-After`; the booth shows it and waits
(hourly and daily limits clear by themselves; the event total does not, and the take fails with a clear
message).

The event dashboard in the studio lists the event's server renders (queued, rendering, done, failed) and
lets an operator start a failed one again (files are kept for a week, and until the guest's link expires).

## How a render runs

`src/runner.ts` holds one job's life (lease, files, render, upload, finish) against injected IO, so its
decisions are unit-tested; `src/index.ts` wires the real IO:

1. `files.ts` downloads the job's files to a temp directory (streamed, retried). A recording that is gone
   is `source_missing`; an intro, song or background that is gone is rendered without, as on a booth.
2. `file-server.ts` serves them to Chrome from `127.0.0.1` under a random per-process token, same-origin,
   so the page needs no CORS and a 100 MB video never travels over the DevTools protocol; Chrome PUTs the
   results back the same way.
3. `chrome.ts` runs the page (`page/entry.ts` → `window.__run`) in a fresh browser context.
   `render-page.ts` builds the job (decodes the overlay, cards and background, mixes the soundtrack), calls
   `render()`, then makes the poster and the lighter messaging copy (DL-8). If Chrome has no H.264
   encoder, the same render runs again with the WebAssembly encoder.
4. The worker registers the outputs with the web app, uploads each to its presigned URL (poster, then the
   lighter copy, then the video) and completes the job; the server checks the sizes in storage first.

A background (CAP-10) uses the on-device segmenter (MediaPipe selfie model, CPU delegate) served from the
page's own directory; the model is fetched at build time by `apps/web/scripts/fetch-segmentation.mjs`
(pinned URL, sha256 checked). A job whose background could not be applied fails the try (a broken
deployment is what that nearly always means) and is rendered plain only on its last try.

## Environment

| variable                   | default          | meaning                                                                            |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `RENDER_API_URL`           | (required)       | the web app's origin                                                               |
| `RENDER_WORKER_SECRET`     | (required)       | the same shared secret the web app holds (32+ random bytes)                        |
| `RENDER_WORKER_ID`         | machine id + pid | shown in the job record                                                            |
| `RENDER_POLL_MS`           | 5000             | how often an idle worker asks for work                                             |
| `RENDER_IDLE_EXIT_MINUTES` | 5                | exit (and let Fly stop the machine) after this long idle; 0: never                 |
| `RENDER_HEARTBEAT_MS`      | 60000            | lease extension interval (the server's lease is 5 minutes)                         |
| `RENDER_MAX_MINUTES`       | 40               | hard limit on one render                                                           |
| `RENDER_WORK_DIR`          | system temp      | where a job's files live while it renders                                          |
| `CHROME_CHANNEL`           | `chrome`         | Playwright channel; Chrome **stable** (Playwright's Chromium has no H.264 encoder) |
| `CHROME_PATH`              | unset            | a Chrome binary to use instead of the channel                                      |

On the web app: `RENDER_WORKER_SECRET` (enables the rung), `FLY_API_TOKEN` and `FLY_APP` (the app starts the
machine when a job is queued; both unset: no-op, for a worker that runs elsewhere), and the three
`SERVER_RENDER_LIMIT_*` values above.

## Build and deploy

```sh
pnpm --filter @immersia/render-worker bundle   # dist/page (what Chrome loads) and dist/index.mjs
pnpm --filter @immersia/render-worker smoke    # builds, then renders fixtures in Chrome (CI runs this)
docker build --platform linux/amd64 -f apps/render-worker/Dockerfile -t immersia-render-worker .
```

Fly.io (scale to zero; see `fly.toml`):

```sh
fly apps create immersia-render-worker
fly secrets set -a immersia-render-worker RENDER_API_URL=https://<the web app> RENDER_WORKER_SECRET=<secret>
fly deploy --config apps/render-worker/fly.toml --dockerfile apps/render-worker/Dockerfile --ha=false
fly tokens create deploy -a immersia-render-worker   # → FLY_API_TOKEN on the web app, with FLY_APP=immersia-render-worker
```

Run locally against a dev server (Chrome stable installed):

```sh
RENDER_API_URL=http://localhost:3000 RENDER_WORKER_SECRET=<same as the web app> \
  pnpm --filter @immersia/render-worker bundle && node apps/render-worker/dist/index.mjs
```

## Tests

- `test/*.test.ts` (Node, `pnpm test`): configuration, the API client, the job state machine and loop
  (lease, heartbeat, timeout, shutdown, lost jobs, idle exit), downloads and uploads, the local file server.
- `pnpm smoke` (Chrome, CI job "Render worker smoke"): in the page, recipes rendered through the worker's own
  code with the render engine's test fixture and decoded (every frame is its source frame; slow motion,
  overlay, end card, soundtrack and a look; a background through the segmenter); then one job end to end
  through the real file server, the production page and Chrome against a fake server.
