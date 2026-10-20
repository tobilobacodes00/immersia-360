import { describe, expect, it } from 'vitest';
import { DELETE_FALLBACK_PHRASE, confirmsDeletion, deletionPhrase, exportFilename } from './privacy';

describe('confirming the deletion of an organization', () => {
  it('needs the exact name, ignoring surrounding spaces only', () => {
    expect(confirmsDeletion('Golden Hour Studio', 'Golden Hour Studio')).toBe(true);
    expect(confirmsDeletion('  Golden Hour Studio ', 'Golden Hour Studio')).toBe(true);
    expect(confirmsDeletion('golden hour studio', 'Golden Hour Studio')).toBe(false);
    expect(confirmsDeletion('Golden Hour', 'Golden Hour Studio')).toBe(false);
    expect(confirmsDeletion('', 'Golden Hour Studio')).toBe(false);
  });

  it('treats composed and decomposed accents as the same name', () => {
    expect(confirmsDeletion('Café Eventos', 'Café Eventos')).toBe(true);
  });

  it('falls back to DELETE for a blank name, so it can always be confirmed', () => {
    expect(deletionPhrase('   ')).toBe(DELETE_FALLBACK_PHRASE);
    expect(confirmsDeletion('DELETE', '')).toBe(true);
    expect(confirmsDeletion('', '')).toBe(false);
  });
});

describe('exportFilename', () => {
  it('is dated and safe to save', () => {
    expect(exportFilename('golden-hour-x3k9a', new Date('2026-10-20T23:30:00Z'))).toBe(
      'immersia-360-golden-hour-x3k9a-2026-10-20.json',
    );
    expect(exportFilename('../../Weird Name!', new Date('2026-01-02T00:00:00Z'))).toBe(
      'immersia-360-weird-name-2026-01-02.json',
    );
    expect(exportFilename('', new Date('2026-01-02T00:00:00Z'))).toBe('immersia-360-organization-2026-01-02.json');
  });
});
