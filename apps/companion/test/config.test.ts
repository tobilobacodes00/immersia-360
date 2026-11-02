import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  APP_NAME,
  ConfigError,
  appBoundDomains,
  buildConfig,
  isPrivateHost,
  patchInfoPlist,
  renderOfflinePage,
  resolveServer,
} from '../src/config';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('resolveServer (the deployed booth the app loads)', () => {
  it('needs a server: the app is a shell around a deployment, not a static export', () => {
    expect(() => resolveServer({})).toThrowError(/COMPANION_SERVER_URL is not set/);
    expect(() => resolveServer({ COMPANION_SERVER_URL: '   ' })).toThrowError(ConfigError);
    expect(() => resolveServer({ COMPANION_SERVER_URL: 'booth.example.com' })).toThrowError(/not a URL/);
  });

  it('keeps the origin only: iOS names exactly this string as the allowed origin of native file reads', () => {
    expect(resolveServer({ COMPANION_SERVER_URL: 'https://booth.example.com' })).toMatchObject({
      origin: 'https://booth.example.com',
      host: 'booth.example.com',
      startPath: null,
      cleartext: false,
    });
    // A trailing slash is not part of the origin.
    expect(resolveServer({ COMPANION_SERVER_URL: 'https://booth.example.com/' }).origin).toBe(
      'https://booth.example.com',
    );
    expect(resolveServer({ COMPANION_SERVER_URL: 'https://Booth.Example.com:8443/' })).toMatchObject({
      origin: 'https://booth.example.com:8443',
      host: 'booth.example.com',
    });
  });

  it('turns a path into the page the app opens first', () => {
    const server = resolveServer({ COMPANION_SERVER_URL: 'https://booth.example.com/studio?from=app#x' });
    expect(server.origin).toBe('https://booth.example.com');
    expect(server.startPath).toBe('/studio?from=app');
  });

  it('refuses anything but https, except a development server on a private network, asked for by name', () => {
    expect(() => resolveServer({ COMPANION_SERVER_URL: 'http://booth.example.com' })).toThrowError(/must be https/);
    expect(() => resolveServer({ COMPANION_SERVER_URL: 'ftp://booth.example.com' })).toThrowError(/must be https/);
    // Plain http to a private address still needs the flag, and the flag does not open the public internet.
    expect(() => resolveServer({ COMPANION_SERVER_URL: 'http://192.168.1.20:3000' })).toThrowError(/must be https/);
    expect(() =>
      resolveServer({ COMPANION_SERVER_URL: 'http://booth.example.com', COMPANION_ALLOW_CLEARTEXT: '1' }),
    ).toThrowError(/must be https/);
    expect(
      resolveServer({ COMPANION_SERVER_URL: 'http://192.168.1.20:3000', COMPANION_ALLOW_CLEARTEXT: '1' }),
    ).toMatchObject({ origin: 'http://192.168.1.20:3000', cleartext: true });
  });

  it('refuses credentials in the URL', () => {
    expect(() => resolveServer({ COMPANION_SERVER_URL: 'https://user:pass@booth.example.com' })).toThrowError(
      /user name or password/,
    );
  });

  it("takes extra hosts the WebView may go to, validated, and never the booth's own twice", () => {
    const server = resolveServer({
      COMPANION_SERVER_URL: 'https://booth.example.com',
      COMPANION_ALLOW_NAVIGATION: ' Cdn.example.com, *.files.example.com ,booth.example.com',
    });
    expect(server.extraHosts).toEqual(['cdn.example.com', '*.files.example.com']);
    expect(() =>
      resolveServer({ COMPANION_SERVER_URL: 'https://booth.example.com', COMPANION_ALLOW_NAVIGATION: 'bad host!' }),
    ).toThrowError(/invalid host/);
  });

  it('knows which hosts are private', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '10.0.0.4',
      '192.168.0.9',
      '172.16.5.1',
      '172.31.255.1',
      'mac.local',
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '11.0.0.1', '300.1.1.1']) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });
});

describe('buildConfig', () => {
  const config = buildConfig({ COMPANION_SERVER_URL: 'https://booth.example.com/studio' });

  it('loads the deployed booth, allow-listing its origin', () => {
    expect(config).toMatchObject({
      appId: APP_ID,
      appName: APP_NAME,
      server: {
        url: 'https://booth.example.com',
        appStartPath: '/studio',
        androidScheme: 'https',
        cleartext: false,
        allowNavigation: ['booth.example.com'],
        errorPath: 'offline.html',
      },
    });
  });

  it('has no start path when the app opens at the root', () => {
    const root = buildConfig({ COMPANION_SERVER_URL: 'https://booth.example.com' });
    expect(root.server).not.toHaveProperty('appStartPath');
  });

  it("lets the booth's service worker run on iOS (app-bound domains), and runs full screen", () => {
    expect(config.ios).toMatchObject({ limitsNavigationsToAppBoundDomains: true });
    expect(config.plugins?.SystemBars).toMatchObject({ hidden: true });
  });

  it('is identified in the user agent, so the server can tell a companion from a browser', () => {
    expect(config.appendUserAgent).toMatch(/^ImmersiaCompanion\/\d+$/);
  });

  it('allows cleartext only for a flagged development server', () => {
    const dev = buildConfig({ COMPANION_SERVER_URL: 'http://10.0.0.5:3000', COMPANION_ALLOW_CLEARTEXT: '1' });
    expect(dev.server).toMatchObject({ cleartext: true, url: 'http://10.0.0.5:3000' });
  });

  it('is the app id the generated native projects were created with', () => {
    // The ids are permanent once published; a change here without regenerating would build a different app.
    expect(read('../android/app/build.gradle')).toContain(`applicationId "${APP_ID}"`);
    expect(read('../ios/App/App.xcodeproj/project.pbxproj')).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID};`);
  });
});

describe('app-bound domains and Info.plist', () => {
  const server = resolveServer({
    COMPANION_SERVER_URL: 'https://booth.example.com',
    COMPANION_ALLOW_NAVIGATION: 'cdn.example.com,*.files.example.com',
  });

  it('lists the booth, the literal extra hosts (the list takes no wildcards) and localhost', () => {
    expect(appBoundDomains(server)).toEqual(['booth.example.com', 'cdn.example.com', 'localhost']);
  });

  it('allows at most the ten iOS permits', () => {
    const many = Array.from({ length: 11 }, (_, i) => `h${i}.example.com`).join(',');
    expect(() =>
      appBoundDomains(
        resolveServer({ COMPANION_SERVER_URL: 'https://booth.example.com', COMPANION_ALLOW_NAVIGATION: many }),
      ),
    ).toThrowError(/at most/);
  });

  const plist = (extra = '') =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>App</string>\n${extra}</dict>\n</plist>\n`;

  it("adds the list to an Info.plist that has none, in the file's own indentation", () => {
    const out = patchInfoPlist(plist(), ['booth.example.com', 'localhost']);
    expect(out).toBe(
      plist(
        '\t<key>WKAppBoundDomains</key>\n\t<array>\n\t\t<string>booth.example.com</string>\n\t\t<string>localhost</string>\n\t</array>\n',
      ),
    );
  });

  it('replaces the list that is there, so a second sync for another server leaves one list', () => {
    const once = patchInfoPlist(plist(), ['old.example.com', 'localhost']);
    const twice = patchInfoPlist(once, ['new.example.com', 'localhost']);
    expect(twice.match(/WKAppBoundDomains/g)).toHaveLength(1);
    expect(twice).toContain('<string>new.example.com</string>');
    expect(twice).not.toContain('old.example.com');
    // And it is stable: the same server again changes nothing.
    expect(patchInfoPlist(twice, ['new.example.com', 'localhost'])).toBe(twice);
  });

  it('works on the Info.plist the project ships with', () => {
    const shipped = read('../ios/App/App/Info.plist');
    const out = patchInfoPlist(shipped, ['booth.example.com', 'localhost']);
    expect(out).toContain('<string>booth.example.com</string>');
    expect(out).toContain('<key>NSCameraUsageDescription</key>');
    expect(out).toContain('<key>NSMicrophoneUsageDescription</key>');
    expect(out.match(/WKAppBoundDomains/g)).toHaveLength(1);
  });

  it('keeps a host with special characters valid XML', () => {
    expect(patchInfoPlist(plist(), ['a&b.example.com'])).toContain('<string>a&amp;b.example.com</string>');
  });
});

describe('the page shown when the booth cannot be reached', () => {
  const template = read('../scripts/offline.template.html');
  const server = resolveServer({ COMPANION_SERVER_URL: 'https://booth.example.com/studio' });

  it('links back to the booth, at the page the app opens', () => {
    const page = renderOfflinePage(template, server);
    expect(page).toContain('href="https://booth.example.com/studio"');
    expect(page).not.toContain('__SERVER_URL__');
  });

  it('speaks the three booth languages', () => {
    for (const phrase of [
      "The booth can't be reached",
      'No se puede acceder a la cabina',
      'Não foi possível acessar a cabine',
    ]) {
      expect(template).toContain(phrase);
    }
  });
});

describe('the native projects', () => {
  it('explain the camera and microphone to whoever is asked', () => {
    const plist = read('../ios/App/App/Info.plist');
    expect(plist).toMatch(/<key>NSCameraUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);
    expect(plist).toMatch(/<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);
  });

  it("use the PWA icon's ink as the Android adaptive background", () => {
    expect(read('../android/app/src/main/res/values/ic_launcher_background.xml')).toContain('#111110');
  });

  it('draw the icons from the one place the PWA icons are drawn', () => {
    const script = read('../scripts/generate-icons.mjs');
    expect(script).toContain('brand-icon.tsx');
    // The glyph proportions it copies from brand-icon.tsx: 46 % for a full-bleed icon, 58 % for a plain one.
    const brand = read('../../web/src/lib/brand-icon.tsx');
    expect(brand).toMatch(/maskable \? 0\.46 : 0\.58/);
    expect(script).toMatch(/MASKABLE_GLYPH = 0\.46/);
    expect(script).toMatch(/PLAIN_GLYPH = 0\.58/);
  });
});
