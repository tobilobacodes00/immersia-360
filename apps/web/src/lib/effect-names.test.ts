import { describe, expect, it } from 'vitest';
import { LOOKS, PHOTO_EFFECTS } from '@immersia/effects';
import en from '@immersia/i18n/messages/en';
import es from '@immersia/i18n/messages/es';
import pt from '@immersia/i18n/messages/pt';

/**
 * Screen 5 shows looks and effects by translated name, looked up by id (LooksCard). Every id needs a
 * name in every language, and a name whose look or effect is gone is stale: exact sets, both ways.
 */
const ids = (defs: readonly { id: string }[]) => defs.map((d) => d.id).sort();

describe('look and effect names', () => {
  for (const [locale, messages] of Object.entries({ en, es, pt }))
    it(`${locale} names every look and photo effect, and nothing else`, () => {
      expect(Object.keys(messages.effects.looks).sort()).toEqual(ids(LOOKS));
      expect(Object.keys(messages.effects.photo).sort()).toEqual(ids(PHOTO_EFFECTS));
    });
});
