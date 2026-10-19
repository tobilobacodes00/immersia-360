import { describe, expect, it } from 'vitest';
import { cellsFrom, emptyCells, fillCells, firstEmpty, pairingChars } from './pairing';

describe('pairingChars (LIV-1)', () => {
  it('uppercases and drops separators', () => {
    expect(pairingChars('k7m-2qx')).toBe('K7M2QX');
    expect(pairingChars(' K7M 2QX \n')).toBe('K7M2QX');
  });

  it('drops characters the code never uses, including the look-alikes', () => {
    // 0, 1, I, L and O are not in the alphabet; Unicode and punctuation neither.
    expect(pairingChars('0O1IL-é.!2')).toBe('2');
    expect(pairingChars('ß')).toBe('');
    expect(pairingChars('')).toBe('');
  });
});

describe('fillCells', () => {
  it('writes from the given box and stops at the last one', () => {
    expect(fillCells(emptyCells(), 0, 'K7M2QX')).toEqual(['K', '7', 'M', '2', 'Q', 'X']);
    expect(fillCells(emptyCells(), 4, 'ABCD')).toEqual(['', '', '', '', 'A', 'B']);
  });

  it('leaves the other boxes alone and never mutates its input', () => {
    const cells = cellsFrom('ABC');
    expect(fillCells(cells, 1, 'Z')).toEqual(['A', 'Z', 'C', '', '', '']);
    expect(cells).toEqual(['A', 'B', 'C', '', '', '']);
  });

  it('finds the first empty box', () => {
    expect(firstEmpty(cellsFrom('AB'))).toBe(2);
    expect(firstEmpty(cellsFrom('ABCDEF'))).toBe(-1);
  });
});
