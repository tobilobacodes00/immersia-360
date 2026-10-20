import { describe, expect, it } from 'vitest';
import { createOpenGuard } from './open-guard';

describe('createOpenGuard', () => {
  it('the only open in flight is current', () => {
    const guard = createOpenGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it('a newer open supersedes the older one (a double tap on Start)', () => {
    const guard = createOpenGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('cancel abandons every open in flight (the booth was left)', () => {
    const guard = createOpenGuard();
    const token = guard.begin();
    guard.cancel();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it('an open started after a cancel is current again', () => {
    const guard = createOpenGuard();
    guard.begin();
    guard.cancel();
    expect(guard.isCurrent(guard.begin())).toBe(true);
  });

  it('guards are independent', () => {
    const a = createOpenGuard();
    const b = createOpenGuard();
    const token = a.begin();
    b.begin();
    b.begin();
    expect(a.isCurrent(token)).toBe(true);
  });

  it('the pattern the booth follows: a stale open stops its own stream and leaves the phase alone', async () => {
    const guard = createOpenGuard();
    const stopped: string[] = [];
    const phases: string[] = [];
    const open = async (name: string, ms: number) => {
      const token = guard.begin();
      phases.push(`starting ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      if (!guard.isCurrent(token)) return stopped.push(name);
      phases.push(`ready ${name}`);
    };
    // The first open is slow (a permission prompt), the second is a quick retry.
    await Promise.all([open('first', 20), open('second', 1)]);
    expect(stopped).toEqual(['first']);
    expect(phases).toEqual(['starting first', 'starting second', 'ready second']);
  });
});
