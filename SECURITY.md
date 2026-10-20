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

## Abuse: reports, takedown and hash matching

**Reporting.** Every share page and the event gallery carry a "Report" link to `/report`: a plain form (no account,
no cookie, no script) with a reason, optional details and an optional contact address. A report is stored with a
_reporter hash_: an HMAC of the network address under a salt derived from the server secret and the UTC date. It
rate-limits one reporter (five a day), cannot be turned back into an address, and cannot be linked across days. The
address itself is never stored. The contact address, if given, is shown only to platform admins and is deleted when
the report is decided. Limits also apply per session and per event.

**24-hour process.** The event's owners and creator, and every platform admin (`ADMIN_EMAILS`), are emailed; the
operator also sees a badge and the report on the event dashboard, and can **hide** the item at once. Admins work
the queue at `/admin/reports`, oldest first, with a 24-hour clock (overdue items are highlighted):

- **Take down** hides the session everywhere at the same moment (the share page answers `451` for illegal content
  and `410` otherwise, and its downloads likewise; the gallery and its ZIP, the Live Display and the Sharing Station
  drop it) and removes the hosted files: deleted for a policy or privacy takedown, **quarantined** under `q/` in the
  bucket for illegal content, so they are out of reach of every link but not destroyed. The operator's own Drive or
  Dropbox copies are theirs and are never touched; copies still waiting to be made are cancelled.
- **Dismiss** closes the report. **Escalate** keeps it open, emails `TRUST_EMAIL` (if set), and can hide the item
  meanwhile with the files quarantined.

Every decision (and every hide or restore by an operator) is written to `audit_log` with the acting user. How long
`q/` is kept is a legal decision: set a bucket lifecycle rule on that prefix once counsel has said how long it must
be kept and who it may be given to.

**Admin access.** `/admin` and every admin action check the `ADMIN_EMAILS` allowlist on the server, require a
verified email, and answer `404` to everyone else.

**Hash matching: what exists and what does not.**

- _Images_: Cloudflare's [CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/) scans
  images served through Cloudflare's cache and notifies you of a match. To use it, serve the hosted bucket through a
  Cloudflare-proxied custom domain with caching on, enable **Caching > Configuration > CSAM Scanning Tool**, and give
  it the contact to notify. It sees only what is fetched through the cache: it does not cover video, nor anything
  never requested, and presigned storage URLs that bypass the CDN are not scanned.
- _Everything else_ (all video, and images that never go through the CDN): the app defines a `MediaScanner`
  interface (`apps/web/src/server/media-scanner.ts`) and calls it for every upload that completes (`completeUpload`
  in `server/sessions.ts`). **The default scans nothing.** Video hash matching needs a vendor and a legal decision
  (which lists, who carries the reporting obligations, in which jurisdictions) that has not been made; until it is,
  no scanner is registered and the admin metrics page says so. To connect one, implement `MediaScanner` and call
  `setMediaScanner()` at startup; a `flagged` verdict takes the session down as illegal and opens a report.
