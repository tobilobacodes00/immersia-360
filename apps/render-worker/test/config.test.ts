import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';

const env = {
  RENDER_API_URL: 'https://immersia.example/',
  RENDER_WORKER_SECRET: 'x'.repeat(32),
};

describe('worker configuration', () => {
  it('needs the web app and the shared secret, and nothing else', () => {
    const cfg = parseConfig(env);
    expect(cfg.apiUrl).toBe('https://immersia.example');
    expect(cfg.chromeChannel).toBe('chrome');
    expect(cfg.pollMs).toBe(5_000);
    expect(cfg.heartbeatMs).toBe(60_000);
    expect(cfg.idleExitMs).toBe(5 * 60_000);
    expect(cfg.maxRenderMs).toBe(40 * 60_000);
  });

  it('refuses a short secret, a missing origin and a bad number, saying which', () => {
    expect(() => parseConfig({ ...env, RENDER_WORKER_SECRET: 'short' })).toThrow(/RENDER_WORKER_SECRET/);
    expect(() => parseConfig({ RENDER_WORKER_SECRET: env.RENDER_WORKER_SECRET })).toThrow(/RENDER_API_URL/);
    expect(() => parseConfig({ ...env, RENDER_POLL_MS: 'soon' })).toThrow(/RENDER_POLL_MS/);
    expect(() => parseConfig({ ...env, RENDER_HEARTBEAT_MS: '1' })).toThrow(/RENDER_HEARTBEAT_MS/);
  });

  it('treats an empty value as unset', () => {
    const cfg = parseConfig({ ...env, RENDER_POLL_MS: '', CHROME_PATH: '', RENDER_IDLE_EXIT_MINUTES: '' });
    expect(cfg.pollMs).toBe(5_000);
    expect(cfg.chromePath).toBeNull();
    expect(cfg.idleExitMs).toBe(5 * 60_000);
  });

  it('turns idle exit off with 0, and in minutes otherwise', () => {
    expect(parseConfig({ ...env, RENDER_IDLE_EXIT_MINUTES: '0' }).idleExitMs).toBeNull();
    expect(parseConfig({ ...env, RENDER_IDLE_EXIT_MINUTES: '12' }).idleExitMs).toBe(12 * 60_000);
  });

  it('names the worker after the Fly machine when there is one', () => {
    expect(parseConfig({ ...env, FLY_MACHINE_ID: 'e286abc' }).workerId).toMatch(/^e286abc-\d+$/);
    expect(parseConfig({ ...env, RENDER_WORKER_ID: 'worker-1' }).workerId).toBe('worker-1');
  });
});
