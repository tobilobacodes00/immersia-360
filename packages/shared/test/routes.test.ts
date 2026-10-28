import { describe, expect, it } from 'vitest';
import { DOWNLOAD_ROUTES, galleryUrl, parseRoute, parseRouteParams, sessionUrl, shortCodeUrl } from '../src/routes';

describe('download routes (DL-13)', () => {
  it('covers the routes the PRD names', () => {
    expect([...DOWNLOAD_ROUTES].sort()).toEqual(
      ['booth', 'code', 'display', 'event_qr', 'message', 'nfc', 'outro', 'print', 'station'].sort(),
    );
  });

  it('parses unknown values as direct', () => {
    expect(parseRoute('print')).toBe('print');
    expect(parseRoute('evil')).toBe('direct');
    expect(parseRoute(null)).toBe('direct');
  });

  it('reads the route from ?r= or, spelled out, from ?route=', () => {
    expect(parseRouteParams({ r: 'print' })).toBe('print');
    expect(parseRouteParams({ route: 'print' })).toBe('print');
    expect(parseRouteParams({ r: 'booth', route: 'print' })).toBe('booth');
    expect(parseRouteParams({ r: 'evil', route: 'print' })).toBe('print');
    expect(parseRouteParams({})).toBe('direct');
  });

  it('tags session and gallery links', () => {
    expect(sessionUrl('https://immersia.app', 'AAAA', 'booth')).toBe('https://immersia.app/s/AAAA?r=booth');
    expect(sessionUrl('https://immersia.app', 'AAAA', 'direct')).toBe('https://immersia.app/s/AAAA');
    expect(galleryUrl('https://immersia.app', 'gold', 'event_qr')).toBe('https://immersia.app/g/gold?r=event_qr');
    expect(shortCodeUrl('https://im.st', 'K7M2QX')).toBe('https://im.st/K7M2QX');
  });
});
