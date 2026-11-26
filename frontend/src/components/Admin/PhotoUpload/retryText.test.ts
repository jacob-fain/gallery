import { describe, expect, it } from 'vitest';
import type { UploadItem } from '../../../utils/uploadQueue';
import { retryText } from './retryText';

const item = (fields: Partial<UploadItem>) =>
  ({ id: 'u1', file: new File([], 'a.jpg'), galleryId: null, checkOnly: false, progress: 0, status: 'retrying', ...fields }) as UploadItem;

describe('retryText', () => {
  it('counts down to the next attempt, naming it', () => {
    expect(retryText(item({ attempts: 2, retryAt: 15_000, retryDelayMs: 15_000 }), 600)).toBe(
      'Retrying in 15s (attempt 3)'
    );
    expect(retryText(item({ attempts: 2, retryAt: 15_000, retryDelayMs: 15_000 }), 14_500)).toBe(
      'Retrying in 1s (attempt 3)'
    );
  });

  it('never counts higher than the wait, whatever a stale clock says', () => {
    expect(retryText(item({ attempts: 1, retryAt: 100_000, retryDelayMs: 2000 }), 0)).toBe('Retrying in 2s (attempt 2)');
  });

  it('says when it waits for the connection, or is asking the server', () => {
    expect(retryText(item({ attempts: 4, offline: true }), 0)).toBe('Waiting for connection (attempt 5)');
    expect(retryText(item({ attempts: 1 }), 0)).toBe('Checking whether it was saved...');
  });
});
