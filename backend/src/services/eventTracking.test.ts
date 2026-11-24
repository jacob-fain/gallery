import { describe, expect, it, vi } from 'vitest';
import { drainTracking, track } from './eventTracking';

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
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    track('test event', () => Promise.reject(new Error('db down')));
    track('sync throw', () => {
      throw new Error('bad');
    });
    await expect(drainTracking()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Failed to record test event:', 'db down');
    expect(error).toHaveBeenCalledWith('Failed to record sync throw:', 'bad');
    error.mockRestore();
  });
});
