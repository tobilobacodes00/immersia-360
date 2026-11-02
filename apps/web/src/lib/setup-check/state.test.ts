import { describe, expect, it } from 'vitest';
import { SETUP_CHECK_KEY, checkIsDue, markCheckDone, markCheckSkipped, readCheckState } from './state';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    raw: () => data.get(SETUP_CHECK_KEY),
  };
};

describe('setup check memory (per device)', () => {
  it('offers the check to a device that has neither run nor skipped it', () => {
    expect(checkIsDue(readCheckState(memory(), 'dev-1'))).toBe(true);
  });

  it('stops offering once it is skipped or done, for that device only', () => {
    const s = memory();
    expect(markCheckSkipped(s, 'dev-1', 100)).toBe(true);
    expect(checkIsDue(readCheckState(s, 'dev-1'))).toBe(false);
    expect(checkIsDue(readCheckState(s, 'dev-2'))).toBe(true);
    markCheckDone(s, 'dev-2', 200);
    expect(readCheckState(s, 'dev-2')).toEqual({ doneAt: 200 });
    // Both devices keep their own state.
    expect(readCheckState(s, 'dev-1')).toEqual({ skippedAt: 100 });
  });

  it('keeps a skip when the check is run later', () => {
    const s = memory();
    markCheckSkipped(s, 'dev-1', 100);
    markCheckDone(s, 'dev-1', 300);
    expect(readCheckState(s, 'dev-1')).toEqual({ skippedAt: 100, doneAt: 300 });
  });

  it('survives garbage in storage', () => {
    for (const raw of ['{', 'null', '[]', '"x"', '{"dev-1":5}', '{"dev-1":{"doneAt":"yesterday"}}']) {
      const s = memory({ [SETUP_CHECK_KEY]: raw });
      expect(checkIsDue(readCheckState(s, 'dev-1')), raw).toBe(true);
      expect(markCheckSkipped(s, 'dev-1', 1)).toBe(true);
      expect(checkIsDue(readCheckState(s, 'dev-1'))).toBe(false);
    }
  });

  it('reports a browser that cannot remember instead of throwing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readCheckState(broken, 'dev-1')).toEqual({});
    expect(markCheckDone(broken, 'dev-1', 1)).toBe(false);
  });
});
