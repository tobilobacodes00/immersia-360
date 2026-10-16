import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeNext('/studio/events?mode=photo#x')).toBe('/studio/events?mode=photo#x');
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', null, undefined, 'studio'])(
    'falls back for %s',
    (value) => {
      expect(safeNext(value)).toBe('/studio');
    },
  );
});
