/**
 * Runs before `cap sync` (the `sync` script): turns COMPANION_SERVER_URL into the files the native projects
 * read that Capacitor does not write itself.
 *
 *   www/index.html, www/offline.html  the page shown when the booth cannot be reached (the app is remote)
 *   ios/App/App/Info.plist            WKAppBoundDomains, so the booth's service worker runs in the WebView
 *
 * Run with Node's type stripping (`node --experimental-strip-types scripts/prepare.mts`).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, appBoundDomains, patchInfoPlist, renderOfflinePage, resolveServer } from '../src/config.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const server = resolveServer(process.env);

  const template = await readFile(join(root, 'scripts', 'offline.template.html'), 'utf8');
  const page = renderOfflinePage(template, server);
  await mkdir(join(root, 'www'), { recursive: true });
  await writeFile(join(root, 'www', 'offline.html'), page);
  await writeFile(join(root, 'www', 'index.html'), page);

  const plistPath = join(root, 'ios', 'App', 'App', 'Info.plist');
  if (existsSync(plistPath)) {
    const before = await readFile(plistPath, 'utf8');
    const after = patchInfoPlist(before, appBoundDomains(server));
    if (after !== before) await writeFile(plistPath, after);
  }
  console.warn(`Companion prepared for ${server.origin}${server.startPath ?? '/'}`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
