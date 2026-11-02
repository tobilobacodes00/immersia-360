import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The companion app's configuration (CAP-14). The app is a native shell around the deployed booth: the
 * WebView loads the booth's own URL, so a web deploy reaches every companion at once and the web code is
 * exactly what runs in the browser. Which deployment to load comes from the environment at sync time.
 */

/** Permanent once an app is published: change it only before the first store upload. */
export const APP_ID = 'com.immersiavr.booth360';
export const APP_NAME = 'Immersia 360';
/** Appended to the WebView's user agent, so the server can tell a companion from a browser. */
export const USER_AGENT_TOKEN = 'ImmersiaCompanion/1';
/** The booth's paper colour: the WebView shows it until the page paints. */
export const PAPER = '#f7f6f2';

/** iOS accepts at most ten app-bound domains. */
const MAX_APP_BOUND_DOMAINS = 10;

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface CompanionServer {
  /**
   * The origin only (`https://booth.example.com`, no path, no trailing slash). Capacitor's iOS file handler
   * answers the booth's cross-origin reads of a recording with a CORS header naming exactly this string, so
   * a path or a slash here would make every native take unreadable.
   */
  origin: string;
  host: string;
  /** Where the app opens first: the path of the URL it was given (`/studio`), or null for `/`. */
  startPath: string | null;
  /** Plain http, allowed only for a development server on a private network. */
  cleartext: boolean;
  /** Hosts the WebView may navigate to besides the booth's own. */
  extraHosts: string[];
}

const HOST_PATTERN = /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

/** localhost, loopback and private network addresses: the only places plain http is acceptable. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '[::1]') return true;
  const parts = h.split('.').map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p > 255)) return false;
  const [a = 0, b = 0] = parts;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Validate `COMPANION_SERVER_URL` (and the optional extras) into what the native projects need. */
export function resolveServer(env: Env): CompanionServer {
  const raw = env.COMPANION_SERVER_URL?.trim();
  if (!raw) {
    throw new ConfigError(
      'COMPANION_SERVER_URL is not set. Set it to the deployed booth, e.g. COMPANION_SERVER_URL=https://booth.example.com/studio',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`COMPANION_SERVER_URL is not a URL: ${raw}`);
  }
  if (url.username || url.password) {
    throw new ConfigError('COMPANION_SERVER_URL must not carry a user name or password.');
  }
  const cleartext = url.protocol === 'http:';
  if (url.protocol !== 'https:' && !cleartext) {
    throw new ConfigError(`COMPANION_SERVER_URL must be https (got ${url.protocol}).`);
  }
  if (cleartext) {
    if (env.COMPANION_ALLOW_CLEARTEXT !== '1' || !isPrivateHost(url.hostname)) {
      throw new ConfigError(
        'COMPANION_SERVER_URL must be https. Plain http is accepted only for a development server on a private ' +
          'address, and only with COMPANION_ALLOW_CLEARTEXT=1.',
      );
    }
  }
  const extraHosts = (env.COMPANION_ALLOW_NAVIGATION ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  for (const host of extraHosts) {
    if (!HOST_PATTERN.test(host)) throw new ConfigError(`COMPANION_ALLOW_NAVIGATION has an invalid host: ${host}`);
  }
  const path = url.pathname + url.search;
  return {
    origin: url.origin,
    host: url.hostname.toLowerCase(),
    startPath: path === '/' ? null : path,
    cleartext,
    extraHosts: extraHosts.filter((h) => h !== url.hostname.toLowerCase()),
  };
}

/** The Capacitor configuration for a server; `capacitor.config.ts` is this, read from the environment. */
export function buildConfig(env: Env): CapacitorConfig {
  const server = resolveServer(env);
  return {
    appId: APP_ID,
    appName: APP_NAME,
    // Holds only the page shown when the booth cannot be reached (see offline.html); the app itself is remote.
    webDir: 'www',
    backgroundColor: PAPER,
    appendUserAgent: USER_AGENT_TOKEN,
    server: {
      url: server.origin,
      ...(server.startPath ? { appStartPath: server.startPath } : {}),
      androidScheme: 'https',
      cleartext: server.cleartext,
      // The booth's own host and nothing else, unless the operator listed more. Everything else opens in the browser.
      allowNavigation: [server.host, ...server.extraHosts],
      errorPath: 'offline.html',
    },
    ios: {
      contentInset: 'never',
      allowsLinkPreview: false,
      // Service workers (the booth's offline shell) run in a WKWebView only for app-bound domains.
      limitsNavigationsToAppBoundDomains: true,
    },
    android: {
      allowMixedContent: false,
    },
    plugins: {
      // A booth runs full screen.
      SystemBars: { hidden: true, insetsHandling: 'css' },
    },
  };
}

/**
 * The WKAppBoundDomains list: the booth's host (plus any extra literal hosts; the list takes no wildcards)
 * and `localhost`, which Capacitor needs there when `limitsNavigationsToAppBoundDomains` is on.
 */
export function appBoundDomains(server: CompanionServer): string[] {
  const domains = [server.host, ...server.extraHosts.filter((h) => !h.startsWith('*.')), 'localhost'];
  const unique = [...new Set(domains)];
  if (unique.length > MAX_APP_BOUND_DOMAINS) {
    throw new ConfigError(
      `iOS allows ${MAX_APP_BOUND_DOMAINS} app-bound domains at most; ${unique.length} were given.`,
    );
  }
  return unique;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `Info.plist` text with `WKAppBoundDomains` set to `domains` (added when missing, replaced when present). */
export function patchInfoPlist(xml: string, domains: readonly string[]): string {
  // The file's own indentation: tabs where it has them (Xcode's and Capacitor's), else the first run of spaces.
  const indent = /\n\t<key>/.test(xml) ? '\t' : (/\n( +)<key>/.exec(xml)?.[1] ?? '\t');
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  const lines = [
    `${indent}<key>WKAppBoundDomains</key>`,
    `${indent}<array>`,
    ...domains.map((d) => `${indent}${indent}<string>${escapeXml(d)}</string>`),
    `${indent}</array>`,
  ].join(nl);
  const existing = /[ \t]*<key>WKAppBoundDomains<\/key>\s*<array>[\s\S]*?<\/array>/;
  if (existing.test(xml)) return xml.replace(existing, () => lines);
  const end = xml.lastIndexOf('</dict>');
  if (end < 0) throw new ConfigError('Info.plist has no closing </dict>.');
  return `${xml.slice(0, end)}${lines}${nl}${xml.slice(end)}`;
}

/** The page shown when the booth cannot be reached: the template with the server's address filled in. */
export function renderOfflinePage(template: string, server: CompanionServer): string {
  const target = server.origin + (server.startPath ?? '/');
  return template.replaceAll('__SERVER_URL__', escapeXml(target));
}
