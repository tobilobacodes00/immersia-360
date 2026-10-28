import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@immersia/shared/ids';

/**
 * What the pairing boxes accept (LIV-1). Pure and server-safe: the page uses it to read `?code=` and
 * the client uses it for typing and pasting.
 */

/** The letters and digits of a pairing code, uppercased; spaces, dashes and anything else are dropped. */
export function pairingChars(text: string): string {
  let out = '';
  for (const ch of text) {
    // Per character: 'ß'.toUpperCase() is two letters, and must not turn one dropped character into two.
    const up = ch.toUpperCase();
    if (up.length === 1 && SHORT_CODE_ALPHABET.includes(up)) out += up;
  }
  return out;
}

export const emptyCells = (): string[] => Array.from({ length: SHORT_CODE_LENGTH }, () => '');

export function cellsFrom(code: string): string[] {
  return emptyCells().map((_, i) => code[i] ?? '');
}

/** Write `chars` into the boxes from `index` on (overflow is dropped), leaving the others as they are. */
export function fillCells(cells: readonly string[], index: number, chars: string): string[] {
  const next = [...cells];
  for (let i = 0; i < chars.length && index + i < next.length; i++) next[index + i] = chars[i]!;
  return next;
}

/** The first box without a character, or -1 when the code is complete. */
export const firstEmpty = (cells: readonly string[]): number => cells.findIndex((c) => !c);
