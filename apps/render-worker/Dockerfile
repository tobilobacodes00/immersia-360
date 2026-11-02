# The server render worker: Node + Google Chrome stable (headless) on Debian.
#
# Chrome STABLE, not Playwright's Chromium: only Chrome ships the H.264 encoder the render needs
# (Playwright's own build has no proprietary codecs). Google publishes the Linux package for amd64 only,
# so this image is amd64 (Fly Machines are).
#
# Build from the repository root (the worker bundles packages from the monorepo):
#   docker build --platform linux/amd64 -f apps/render-worker/Dockerfile -t immersia-render-worker .
#
# Runs as a non-root user. The worker starts Chrome with Playwright's defaults, which pass --no-sandbox:
# the container is the sandbox, and the only page it ever opens is its own render page on 127.0.0.1.
FROM --platform=linux/amd64 node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg fonts-liberation \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

# pnpm, at the version the repository pins (package.json "packageManager").
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Playwright drives the Chrome installed above; it must not download its own browsers.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /repo
COPY . .

# Only what the worker needs (and what it needs to build): its dependencies and the workspace packages
# it bundles. The bundle step also fetches the person-segmentation model (pinned URL, sha256 checked).
RUN pnpm install --frozen-lockfile --filter @immersia/render-worker... \
 && pnpm --filter @immersia/render-worker bundle

RUN useradd --create-home --shell /usr/sbin/nologin render \
 && mkdir -p /work \
 && chown -R render:render /work /home/render
USER render

ENV NODE_ENV=production
ENV RENDER_WORK_DIR=/work
ENV CHROME_CHANNEL=chrome

# RENDER_API_URL and RENDER_WORKER_SECRET come from the platform's secrets (see README.md).
WORKDIR /repo/apps/render-worker
CMD ["node", "dist/index.mjs"]
