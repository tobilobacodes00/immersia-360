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
