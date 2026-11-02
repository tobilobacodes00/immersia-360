import { chromium, type Browser, type Page } from 'playwright';
import type { RunResult, RunSpec } from '../page/protocol';
import { JobError } from './runner';

/**
 * Headless Chrome, driven with Playwright. Chrome STABLE (`channel: 'chrome'`), not Playwright's own
 * Chromium: only Chrome ships the H.264 encoder the render needs. It is started once and kept for
 * the worker's life (a launch costs seconds); every job gets a fresh browser context, closed after it.
 */

export interface ChromeOptions {
  channel: string;
  executablePath: string | null;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/** A server has no GPU: WebGL2 runs on SwiftShader, which Chrome only enables as a fallback with these. */
export const CHROME_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  // Docker's /dev/shm is tiny; Chrome would crash on a big frame otherwise.
  '--disable-dev-shm-usage',
  // A background video must play without a gesture.
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
];

export interface OpenPage {
  page: Page;
  /** Closes the page's whole browser context. */
  close: () => Promise<void>;
}

export class ChromeHost {
  private browser: Browser | null = null;

  constructor(private readonly opts: ChromeOptions) {}

  private async ensure(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const browser = await chromium.launch({
      headless: true,
      ...(this.opts.executablePath ? { executablePath: this.opts.executablePath } : { channel: this.opts.channel }),
      args: CHROME_ARGS,
    });
    // A crashed Chrome is relaunched for the next job.
    browser.on('disconnected', () => {
      if (this.browser === browser) this.browser = null;
    });
    this.browser = browser;
    this.opts.log?.('chrome started', { version: browser.version() });
    return browser;
  }

  /** A fresh page in its own browser context (cookies, storage and caches are never shared between jobs). */
  async open(): Promise<OpenPage> {
    const browser = await this.ensure();
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        this.opts.log?.('page ' + m.type(), { text: m.text().slice(0, 500) });
    });
    page.on('pageerror', (e) => this.opts.log?.('page error', { text: e.message.slice(0, 500) }));
    return { page, close: () => context.close().catch(() => undefined) };
  }

  /**
   * Open the render page, run the spec, return the page's answer. `signal` closes the page (the
   * render stops); the caller maps that to why it was aborted.
   */
  async run(pageUrl: string, spec: RunSpec, signal: AbortSignal, onProgress: (p: number) => void): Promise<RunResult> {
    signal.throwIfAborted();
    const { page, close } = await this.open();
    const stopOnAbort = () => void close();
    signal.addEventListener('abort', stopOnAbort, { once: true });
    try {
      signal.throwIfAborted();
      const crashed = new Promise<never>((_, reject) =>
        page.on('crash', () => reject(new JobError('failed', 'The Chrome tab crashed'))),
      );
      await page.exposeFunction('__progress', (p: number) => onProgress(p));
      await page.goto(pageUrl, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction('typeof window.__run === "function"', null, { timeout: 30_000 });
      return await Promise.race([page.evaluate((s) => window.__run(s), spec), crashed]);
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof JobError) throw err;
      // The browser went away under us (killed, out of memory): to the server that is a retryable failure.
      throw new JobError(
        'failed',
        err instanceof Error ? (err.message.split('\n')[0] ?? 'Chrome failed') : String(err),
      );
    } finally {
      signal.removeEventListener('abort', stopOnAbort);
      await close();
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }
}
