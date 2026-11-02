# @immersia/realtime

The realtime hub for Live Display, the Sharing Station and operator control pages (LIV-2, LIV-12): a
Cloudflare Worker with one SQLite-backed Durable Object per event.

The web app (Next.js on Vercel) and its database are the source of truth. The hub only fans small
messages out to connected screens within a second, and lets a screen that reconnects resume from where
it left off. A screen that can't hold a socket polls the feed instead and still meets LIV-2's five
seconds, so the hub being down degrades the experience and never loses data.

## Protocol

The contract lives in [`packages/shared/src/live.ts`](../../packages/shared/src/live.ts) and is shared
with the web app: the `LiveMessage` / `LivePublish` types, who receives what (`deliversTo`), the signed
screen tokens (`signLiveToken` / `verifyLiveToken`) and the signed publish requests (`signPublish` /
`verifyPublish`). In short: the web app `POST`s a `LivePublish` (item, remove, config, queue) to
`/events/:eventId/publish`; the hub gives it the event's next sequence number (1, 2, 3, ...), keeps the
last 1000 messages, and sends it as a JSON text frame to every connected screen that may see it. A
screen opens `/events/:eventId/socket` with a token from the web app and the `seq` it last saw; the hub
replays what it missed (or sends `reset` if it fell further behind than the 1000 it remembers) and then
`hello` with its current position. A text frame `ping` is answered with `pong` for keep-alives.

## Routes

| Route                                       | Who                | Notes                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                               | anyone             | `200 ok`                                                                                                                                                                                                                                                                             |
| `POST /events/:eventId/publish`             | the web app        | Headers `x-live-timestamp` (unix seconds, within 5 minutes) and `x-live-signature` (HMAC over `<timestamp>.<raw body>`). Body is a `LivePublish`, at most 64 KiB. Answers `{ "seq": n }`. `401` bad or stale signature, `400` invalid body, `413` too large, `502` room unavailable. |
| `GET /events/:eventId/socket?token=&since=` | a screen (browser) | Must be a WebSocket upgrade (`426` otherwise). `401` bad or expired token, `403` token for another event or origin not allowed, `400` malformed `since`. `since` is optional.                                                                                                        |

`:eventId` must be a UUID (`400` otherwise). Tokens are never logged, and a token is checked before the
event's room is touched.

## Deploy

```sh
# once: authenticate (or set CLOUDFLARE_API_TOKEN in CI)
pnpm --filter @immersia/realtime exec wrangler login

# deploy the Worker and run the Durable Object migration
pnpm --filter @immersia/realtime run deploy

# set the shared secret (32+ random bytes, e.g. `openssl rand -base64 48`); never commit it
pnpm --filter @immersia/realtime exec wrangler secret put REALTIME_SIGNING_SECRET
```

Use `run deploy`: `pnpm deploy` on its own is a built-in pnpm command, not this package's script.
Until the secret is set, the event routes answer `500 not_configured`.

`ALLOWED_ORIGINS` is a comma-separated list of the page origins allowed to open a socket (for example
`https://immersia.example`). Edit `vars.ALLOWED_ORIGINS` in `wrangler.jsonc` and redeploy; empty allows
any origin. The check stops other websites from opening sockets with a token they were handed, it is
not a replacement for the token.

### Web app configuration

| Variable                  | Value                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `REALTIME_URL`            | The hub's base URL: `https://immersia-realtime.<account>.workers.dev` or a custom domain. The app derives the `wss://` socket URL from it. |
| `REALTIME_SIGNING_SECRET` | The same value as the Worker's secret. Signs publishes and screen tokens on one side and verifies them on the other.                       |

## Local development

Copy `.dev.vars.example` to `.dev.vars`, put the same secret in it as in the web app's environment, and
run `pnpm --filter @immersia/realtime dev`. Wrangler serves the Worker and a local Durable Object on
`http://localhost:8787`.

## Layout

- `src/core.ts`: the log, replay and delivery rules as pure TypeScript (no Cloudflare types).
- `src/room.ts`: `EventRoom`, the Durable Object: SQLite log and hibernating WebSockets.
- `src/worker.ts`: request validation and routing to the rooms.
- `src/index.ts`: the entry point wrangler loads.
