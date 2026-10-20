import { describe, expect, it } from 'vitest';
import { browserFamily, isLinkPreviewBot } from '../src/browser';
import { crashFingerprint, firstStackFrame, fnv1a, isIgnorableError, scriptPath } from '../src/crash';

describe('crash fingerprints (no PII)', () => {
  it('hashes the same place the same way, whatever the origin or query string', () => {
    const a = crashFingerprint({
      name: 'TypeError',
      filename: 'https://booth.example.com/_next/static/chunks/a1b2.js?x=guest@example.com',
      line: 10,
      col: 4,
    });
    const b = crashFingerprint({
      name: 'TypeError',
      filename: 'http://127.0.0.1:3100/_next/static/chunks/a1b2.js',
      line: 10,
      col: 4,
    });
    expect(a).toEqual(b);
    expect(a.location).toMatch(/^[0-9a-f]{8}$/);
  });

  it('tells places apart', () => {
    const at = (line: number) => crashFingerprint({ name: 'Error', filename: '/a.js', line, col: 1 }).location;
    expect(at(1)).not.toBe(at(2));
  });

  it('carries the error name only when it is a plain identifier', () => {
    expect(crashFingerprint({ name: 'RangeError', filename: '/a.js', line: 1, col: 1 }).error_name).toBe('RangeError');
    expect(
      crashFingerprint({ name: 'could not open /Users/ana/clip.mov', filename: '/a.js', line: 1 }).error_name,
    ).toBe('Error');
    expect(crashFingerprint({ name: null, filename: '/a.js', line: 1 }).error_name).toBe('Error');
  });

  it('finds the location in a stack when the event has none (rejections)', () => {
    const stack =
      'TypeError: x is undefined\n    at run (https://app.test/_next/static/chunks/b.js:12:34)\n    at y (…)';
    expect(firstStackFrame(stack)).toEqual({
      filename: 'https://app.test/_next/static/chunks/b.js',
      line: 12,
      col: 34,
    });
    const viaStack = crashFingerprint({ name: 'TypeError', stack });
    const viaEvent = crashFingerprint({
      name: 'TypeError',
      filename: 'https://app.test/_next/static/chunks/b.js',
      line: 12,
      col: 34,
    });
    expect(viaStack).toEqual(viaEvent);
  });

  it('never puts the message or any text of the stack in the report', () => {
    const f = crashFingerprint({
      name: 'Error',
      stack: 'Error: guest@example.com\n    at x (https://app.test/a.js:1:1)',
    });
    expect(JSON.stringify(f)).not.toContain('guest');
    expect(Object.keys(f).sort()).toEqual(['error_name', 'location']);
  });

  it('copes with nothing to go on', () => {
    expect(crashFingerprint({})).toEqual({ error_name: 'Error', location: fnv1a('unknown') });
  });

  it('strips origin, query and fragment from a script path', () => {
    expect(scriptPath('https://x.test:3000/_next/a.js?v=1#h')).toBe('/_next/a.js');
    expect(scriptPath(null)).toBe('');
  });

  it('ignores browser noise that is not a crash', () => {
    expect(isIgnorableError('ResizeObserver loop completed with undelivered notifications.', '')).toBe(true);
    expect(isIgnorableError('Script error.', '')).toBe(true);
    expect(isIgnorableError('Script error.', 'https://x.test/a.js')).toBe(false);
    expect(isIgnorableError('x is not a function', 'https://x.test/a.js')).toBe(false);
  });
});

describe('browserFamily and link-preview robots', () => {
  const UA = {
    chrome:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    headless:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
    safari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    iosChrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    samsung:
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    whatsapp: 'WhatsApp/2.24.10.80 A',
    facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    imessage:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  };

  it('names the family and nothing else', () => {
    expect(browserFamily(UA.chrome)).toBe('chrome');
    expect(browserFamily(UA.headless)).toBe('chrome');
    expect(browserFamily(UA.safari)).toBe('safari');
    expect(browserFamily(UA.iosChrome)).toBe('chrome');
    expect(browserFamily(UA.firefox)).toBe('firefox');
    expect(browserFamily(UA.edge)).toBe('edge');
    expect(browserFamily(UA.samsung)).toBe('samsung');
    expect(browserFamily('')).toBe('other');
    expect(browserFamily(null)).toBe('other');
  });

  it('does not count link previews as guests, but counts real browsers and test browsers', () => {
    for (const ua of [UA.whatsapp, UA.facebook, UA.googlebot, UA.slack, UA.imessage])
      expect(isLinkPreviewBot(ua), ua).toBe(true);
    for (const ua of [UA.chrome, UA.headless, UA.safari, UA.iosChrome, UA.firefox, UA.edge, UA.samsung])
      expect(isLinkPreviewBot(ua), ua).toBe(false);
    expect(isLinkPreviewBot(null)).toBe(false);
  });
});
