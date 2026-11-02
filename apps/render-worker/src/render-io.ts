import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobFileUrls, RunSpec } from '../page/protocol';
import type { ClaimedJob } from './api';
import type { ChromeHost } from './chrome';
import { outputPath, type FileServer } from './file-server';
import { JOB_FILES, type JobFile } from './files';
import { JobError, type JobIO, type OutputFile } from './runner';

/** The spec's name for each file the job has. */
const SPEC_KEY: Record<JobFile, keyof JobFileUrls> = {
  original: 'original',
  overlay: 'overlay',
  end_card: 'endCard',
  intro: 'intro',
  outro: 'outro',
  music: 'music',
  background: 'background',
};

const sizeOf = async (path: string) => (await stat(path).catch(() => null))?.size ?? null;

/**
 * The rendering half of the runner's IO: point the file server at the job's directory, hand the recipe
 * to the page in Chrome, and collect the results it PUT back. The files stay on disk; only sizes are
 * checked here. The page is the booth's renderer (see page/render-page.ts), so this is where "the same
 * `render()`" meets the server.
 */
export function renderIO(deps: {
  server: FileServer;
  chrome: ChromeHost;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}): Pick<JobIO, 'render'> {
  const { server, chrome, log } = deps;
  return {
    async render(job: ClaimedJob, dir, signal, onProgress) {
      server.setJobDir(dir);
      try {
        const files: JobFileUrls = {};
        for (const name of JOB_FILES)
          if ((await sizeOf(join(dir, name))) !== null) files[SPEC_KEY[name]] = `${server.base}/job/${name}`;
        const spec: RunSpec = {
          recipe: job.recipe,
          mediapipeBase: `${server.base}/page/mediapipe`,
          files,
          put: {
            mp4: `${server.base}/out/mp4`,
            small: `${server.base}/out/small_mp4`,
            poster: `${server.base}/out/poster`,
          },
        };
        const result = await chrome.run(`${server.base}/page/index.html`, spec, signal, onProgress);
        if (!result.ok) throw new JobError(result.code, result.message);
        if (result.encoder === 'wasm')
          log?.('rendered with the WebAssembly encoder: Chrome has no H.264 encoder', { job: job.id });
        // A background that could not be applied renders the take as filmed, as on a booth. On a server
        // that is almost always a broken deployment (the model is missing), which a retry or a fix
        // repairs, so it fails the try; only the last try accepts the plain video, so the guest gets one.
        if (result.background === 'unavailable' && job.attempts < job.maxAttempts)
          throw new JobError('failed', 'The background could not be applied');

        const outputs: OutputFile[] = [];
        for (const out of result.outputs) {
          const path = outputPath(dir, out.kind);
          const onDisk = await sizeOf(path);
          if (onDisk !== out.bytes)
            throw new JobError('failed', `${out.kind} is ${onDisk} bytes on disk, ${out.bytes} expected`);
          outputs.push({ ...out, path });
        }
        if (!outputs.some((o) => o.kind === 'mp4')) throw new JobError('failed', 'The render produced no video');
        return { outputs, renderMs: result.renderMs };
      } finally {
        server.setJobDir(null);
      }
    },
  };
}
