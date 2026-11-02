import { describe, expect, it } from 'vitest';
import { loopedBeats } from '../src/beats';

describe('loopedBeats (a highlight reel longer than its song)', () => {
  const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];

  it('moves the played part to the start of the reel', () => {
    // The song's trimmed part starts at 1 s and runs 2 s: its beats at 1, 1.5, 2 and 2.5.
    expect(loopedBeats(beats, 1, 2, 2)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('starts the song over, with its beats, when the reel is longer', () => {
    expect(loopedBeats(beats, 1, 2, 5)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  });

  it('keeps only beats up to the end of the reel', () => {
    const out = loopedBeats(beats, 0, 4, 3.2);
    expect(out.at(-1)).toBe(3);
    expect(out.every((t) => t <= 3.2)).toBe(true);
  });

  it('ignores beats outside the played part, and has none for an empty one', () => {
    expect(loopedBeats(beats, 2, 1, 1)).toEqual([0, 0.5]);
    expect(loopedBeats(beats, 2, 0, 10)).toEqual([]);
    expect(loopedBeats([], 0, 5, 10)).toEqual([]);
  });

  it('stays in ascending order across repeats', () => {
    const out = loopedBeats(beats, 0.5, 3, 20);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });
});
