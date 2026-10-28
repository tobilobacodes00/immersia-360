# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** (Security tab) rather than a
public issue. Include steps to reproduce and the impact you see. We aim to acknowledge reports within three working
days.

Booth devices authenticate with their own revocable tokens, guest links use 128-bit identifiers, and short-code
lookups are rate-limited; if you find a way around any of these, that is exactly what we want to hear about.

Connections to an operator's own Google Drive or Dropbox are optional. Their refresh tokens exist only on the
server, encrypted at rest with AES-256-GCM (`INTEGRATION_TOKEN_KEY`, bound to the organization and provider),
are never sent to the browser or logged, and are revoked at the provider when the operator disconnects. The
OAuth `state` is signed, expires after ten minutes and names the operator, organization and provider; Drive
access is limited to the `drive.file` scope (files and folders Immersia creates itself).

The server render fallback (`apps/render-worker`, the last rung of the booth's render ladder) holds no database or
storage credentials. It authenticates to `/api/render-worker/*` with one shared secret (`RENDER_WORKER_SECRET`,
compared in constant time; without it the whole rung is off), and gets short-lived presigned links for exactly one
job's files, plus a per-claim token that its later calls must present, so a worker whose lease lapsed cannot finish a
job twice. A booth never names a storage key: the server derives them from ids it has checked, and a recipe's library
assets must belong to the event's organization. A guest who erases their session stops its server renders and loses
the working copies of the recording. Server renders cost money, so they are limited per event and per organization.
The render page runs headless Chrome against files served from `127.0.0.1` under a random per-process token. The test
hook that makes a booth fail a render rung on purpose only answers when the server runs in E2E mode, which it refuses
to do on any Vercel deployment.
