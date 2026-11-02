/* eslint-disable no-console -- a command-line program: its output is the log */
import { fileURLToPath } from 'node:url';
import { createApi } from './api';
import { ChromeHost } from './chrome';
import { parseConfig } from './config';
import { startFileServer } from './file-server';
import { fileIO } from './files';
import { renderIO } from './render-io';
import { workLoop, type JobIO } from './runner';

/** One JSON object per line on stdout (Fly collects it). Never a URL (they carry signatures) or a secret. */
function log(message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: message, ...extra }));
}

async function main() {
  const cfg = parseConfig(process.env);
  const api = createApi(cfg);
  const server = await startFileServer({ page: fileURLToPath(new URL('./page', import.meta.url)) });
  const chrome = new ChromeHost({ channel: cfg.chromeChannel, executablePath: cfg.chromePath, log });
  const io: JobIO = { ...fileIO(cfg.workDir), ...renderIO({ server, chrome, log }) };

  // A machine that is stopping (Fly sends SIGTERM) lets the job in hand fail with `shutdown`: the server
  // queues it again straight away, and the next worker to start picks it up.
  const stop = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => stop.abort());

  log('render worker started', { worker: cfg.workerId, idleExitMinutes: cfg.idleExitMs ? cfg.idleExitMs / 60_000 : 0 });
  try {
    const why = await workLoop(
      api,
      io,
      { heartbeatMs: cfg.heartbeatMs, maxRenderMs: cfg.maxRenderMs, log },
      { pollMs: cfg.pollMs, idleExitMs: cfg.idleExitMs, log },
      stop.signal,
    );
    log('render worker exiting', { why });
  } finally {
    await chrome.close();
    await server.close();
  }
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), msg: 'render worker crashed', error: String(err) }));
  // Not 0: a crash is restarted by the platform's on-failure policy, an idle exit is not.
  process.exitCode = 1;
});
