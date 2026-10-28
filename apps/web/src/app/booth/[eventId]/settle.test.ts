import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettler } from './settle';

describe('createSettler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits the last of a run of choices, once, after the delay', () => {
    const commit = vi.fn();
    const settler = createSettler<string>(commit, 500);
    settler.choose('a');
    vi.advanceTimersByTime(300);
    settler.choose('b');
    vi.advanceTimersByTime(300);
    settler.choose('c');
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('c');
  });

  it('an immediate choice commits at once and drops the wait', () => {
    const commit = vi.fn();
    const settler = createSettler<string>(commit, 500);
    settler.choose('a');
    settler.choose('b', true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('b');
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('flush commits the pending choice now, and only if there is one', () => {
    const commit = vi.fn();
    const settler = createSettler<number>(commit, 500);
    settler.flush();
    expect(commit).not.toHaveBeenCalled();
    settler.choose(7);
    settler.flush();
    expect(commit).toHaveBeenCalledWith(7);
    settler.flush();
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('cancel forgets the pending choice', () => {
    const commit = vi.fn();
    const settler = createSettler<string>(commit, 500);
    settler.choose('a');
    settler.cancel();
    vi.advanceTimersByTime(1000);
    settler.flush();
    expect(commit).not.toHaveBeenCalled();
  });

  it('a choice made after a commit starts a new wait', () => {
    const commit = vi.fn();
    const settler = createSettler<string>(commit, 500);
    settler.choose('a');
    vi.advanceTimersByTime(500);
    settler.choose('b');
    vi.advanceTimersByTime(500);
    expect(commit.mock.calls).toEqual([['a'], ['b']]);
  });

  it('a falsy choice is still a choice', () => {
    const commit = vi.fn();
    const settler = createSettler<number>(commit, 500);
    settler.choose(0);
    settler.flush();
    expect(commit).toHaveBeenCalledWith(0);
  });
});
