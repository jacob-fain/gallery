import { describe, expect, it, vi } from 'vitest';
import { drainTracking, track } from './eventTracking';
import { logger } from '../utils/logger';

describe('track', () => {
  it('returns before the write finishes, and drainTracking waits for it', async () => {
    let finish: () => void = () => {};
    let finished = false;
    track('test', () => new Promise<void>((r) => (finish = () => { finished = true; r(); })));

    const drained = drainTracking();
    await new Promise((r) => setImmediate(r));
    expect(finished).toBe(false);

    finish();
    await drained;
    expect(finished).toBe(true);
  });

  it('logs a failed write instead of rejecting', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    track('test event', () => Promise.reject(new Error('db down')));
    track('sync throw', () => {
      throw new Error('bad');
    });
    await expect(drainTracking()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Failed to record test event', { err: new Error('db down') });
    expect(error).toHaveBeenCalledWith('Failed to record sync throw', { err: new Error('bad') });
    error.mockRestore();
  });
});
