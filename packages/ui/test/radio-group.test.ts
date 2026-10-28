import { describe, expect, it } from 'vitest';
import { nextRadio, tabStop } from '../src/radio-group';

const ABC = ['a', 'b', 'c', 'd'] as const;

describe('nextRadio (ARIA radio group keys)', () => {
  it('Right and Down go to the next radio, Left and Up to the previous', () => {
    expect(nextRadio(ABC, 'b', 'ArrowRight')).toBe('c');
    expect(nextRadio(ABC, 'b', 'ArrowDown')).toBe('c');
    expect(nextRadio(ABC, 'b', 'ArrowLeft')).toBe('a');
    expect(nextRadio(ABC, 'b', 'ArrowUp')).toBe('a');
  });

  it('wraps at both ends', () => {
    expect(nextRadio(ABC, 'd', 'ArrowRight')).toBe('a');
    expect(nextRadio(ABC, 'a', 'ArrowLeft')).toBe('d');
  });

  it('Home and End go to the first and last', () => {
    expect(nextRadio(ABC, 'c', 'Home')).toBe('a');
    expect(nextRadio(ABC, 'b', 'End')).toBe('d');
  });

  it('skips radios that cannot be used', () => {
    const off = (v: string) => v === 'c';
    expect(nextRadio(ABC, 'b', 'ArrowRight', off)).toBe('d');
    expect(nextRadio(ABC, 'd', 'ArrowLeft', off)).toBe('b');
    expect(nextRadio(ABC, 'b', 'End', (v) => v === 'd')).toBe('c');
    expect(nextRadio(ABC, 'b', 'Home', (v) => v === 'a')).toBe('b');
  });

  it('ignores every other key', () => {
    for (const key of ['Enter', ' ', 'Tab', 'a', 'PageDown', 'Escape'])
      expect(nextRadio(ABC, 'b', key)).toBeUndefined();
  });

  it('a single radio stays where it is', () => {
    expect(nextRadio(['x'], 'x', 'ArrowRight')).toBe('x');
    expect(nextRadio(['x'], 'x', 'End')).toBe('x');
  });

  it('nothing to go to when every radio is off', () => {
    expect(nextRadio(ABC, 'b', 'ArrowRight', () => true)).toBe('b');
    expect(nextRadio([] as string[], 'b', 'ArrowRight')).toBeUndefined();
  });
});

describe('tabStop (roving tabindex)', () => {
  it('is the selected radio', () => {
    expect(tabStop(ABC, 'c')).toBe('c');
  });

  it('is the first radio when nothing is selected, or the selection is not in the group', () => {
    expect(tabStop(ABC, null)).toBe('a');
    expect(tabStop(ABC, 'zzz' as 'a')).toBe('a');
  });

  it('is the first radio that can be used when the selected one cannot', () => {
    expect(tabStop(ABC, 'b', (v) => v === 'b' || v === 'a')).toBe('c');
  });

  it('is nothing when every radio is off', () => {
    expect(tabStop(ABC, 'b', () => true)).toBeUndefined();
  });
});
