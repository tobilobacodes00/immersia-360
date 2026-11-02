import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/** An optional string that treats an empty value (`KEY=`) as unset. */
const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), type.optional());

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const schema = z.object({
  /** The web app's origin (the worker calls /api/render-worker/* on it). */
  RENDER_API_URL: z.url(),
  /** The shared secret: the same RENDER_WORKER_SECRET the web app holds. */
  RENDER_WORKER_SECRET: z.string().min(32, 'RENDER_WORKER_SECRET must be at least 32 characters'),
  RENDER_WORKER_ID: optional(z.string().min(1).max(80)),
  /** How often an idle worker asks for work. */
  RENDER_POLL_MS: optional(int(500, 600_000)),
  /** A worker with nothing to do for this many minutes exits, and Fly stops the machine (0: never). */
  RENDER_IDLE_EXIT_MINUTES: optional(int(0, 24 * 60)),
  /** How often a running job extends its lease. Must be well inside the server's lease (5 minutes). */
  RENDER_HEARTBEAT_MS: optional(int(5_000, 120_000)),
  /** Hard limit on one render; the server enforces its own as well. */
  RENDER_MAX_MINUTES: optional(int(1, 120)),
  RENDER_WORK_DIR: optional(z.string().min(1)),
  /** Chrome stable: Playwright's own Chromium has no H.264 encoder. */
  CHROME_CHANNEL: optional(z.string().min(1)),
  /** A Chrome binary to use instead of the channel (CI images, unusual installs). */
  CHROME_PATH: optional(z.string().min(1)),
});

export interface WorkerConfig {
  apiUrl: string;
  secret: string;
  workerId: string;
  pollMs: number;
  /** null: never exit when idle. */
  idleExitMs: number | null;
  heartbeatMs: number;
  maxRenderMs: number;
  workDir: string;
  chromeChannel: string;
  chromePath: string | null;
}

export function parseConfig(env: Record<string, string | undefined>): WorkerConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid render worker environment:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;
  const idle = e.RENDER_IDLE_EXIT_MINUTES ?? 5;
  return {
    apiUrl: e.RENDER_API_URL.replace(/\/$/, ''),
    secret: e.RENDER_WORKER_SECRET,
    // Fly sets FLY_MACHINE_ID; the pid tells restarts on one machine apart.
    workerId: e.RENDER_WORKER_ID ?? `${env.FLY_MACHINE_ID ?? hostname()}-${process.pid}`.slice(0, 80),
    pollMs: e.RENDER_POLL_MS ?? 5_000,
    idleExitMs: idle === 0 ? null : idle * 60_000,
    heartbeatMs: e.RENDER_HEARTBEAT_MS ?? 60_000,
    maxRenderMs: (e.RENDER_MAX_MINUTES ?? 40) * 60_000,
    workDir: e.RENDER_WORK_DIR ?? join(tmpdir(), 'immersia-render'),
    chromeChannel: e.CHROME_CHANNEL ?? 'chrome',
    chromePath: e.CHROME_PATH ?? null,
  };
}
