import { describe, expect, it } from 'vitest';
import { decideWake } from './render-worker-wake-core';

const m = (id: string, state: string) => ({ id, state });

describe('waking the scale-to-zero render worker', () => {
  it('does nothing while a machine is up or coming up: it serves the whole queue', () => {
    for (const state of ['started', 'starting', 'created', 'replacing'])
      expect(decideWake([m('a', 'stopped'), m('b', state)])).toEqual({ action: 'none', reason: 'running' });
  });

  it('starts a stopped (or suspended) machine when none is up', () => {
    expect(decideWake([m('a', 'stopped')])).toEqual({ action: 'start', id: 'a' });
    expect(decideWake([m('a', 'destroyed'), m('b', 'suspended')])).toEqual({ action: 'start', id: 'b' });
  });

  it('leaves a machine that is stopping alone: the next call finds it stopped', () => {
    expect(decideWake([m('a', 'stopping')])).toEqual({ action: 'none', reason: 'running' });
  });

  it('says so when the app has no machine at all', () => {
    expect(decideWake([])).toEqual({ action: 'none', reason: 'no_machine' });
    expect(decideWake([m('a', 'destroyed')])).toEqual({ action: 'none', reason: 'no_machine' });
  });
});
