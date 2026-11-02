import { describe, expect, it } from 'vitest';
import { signageFilename, slugify } from './signage-export';

describe('signage file names', () => {
  it('slugifies event names', () => {
    expect(slugify('Sarah & Tom’s Wedding')).toBe('sarah-and-toms-wedding');
    expect(slugify('  Gala 360 — 2026!  ')).toBe('gala-360-2026');
    expect(slugify('Fiesta de Año Nuevo, São Paulo')).toBe('fiesta-de-ano-nuevo-sao-paulo');
    expect(slugify('東京 Launch')).toBe('東京-launch');
    expect(slugify('***')).toBe('');
  });

  it('keeps them short, without a trailing dash', () => {
    const slug = slugify(`${'word '.repeat(30)}end`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('names the file <event-name>-<format>.<ext>', () => {
    expect(signageFilename('Alpha wedding', 'a4', 'pdf')).toBe('alpha-wedding-a4.pdf');
    expect(signageFilename('Alpha wedding', 'tent', 'png')).toBe('alpha-wedding-tent.png');
    expect(signageFilename('???', 'a5', 'pdf')).toBe('event-a5.pdf');
  });
});
