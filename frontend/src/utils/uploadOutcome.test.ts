import { describe, expect, it } from 'vitest';
import { uploadOutcome } from './uploadOutcome';

const rejected = (message: string, status: number) => Object.assign(new Error(message), { status });

describe('uploadOutcome', () => {
  it('treats a 409 as a skipped duplicate with the server message as its note', () => {
    expect(uploadOutcome(rejected('Already uploaded as IMG_1.jpg', 409))).toEqual({
      kind: 'duplicate',
      note: 'Already uploaded as IMG_1.jpg',
    });
  });

  it('offers no retry for a rejection that would repeat', () => {
    for (const status of [400, 413, 415]) {
      expect(uploadOutcome(rejected('No', status))).toEqual({ kind: 'failed', error: 'No', retryable: false });
    }
  });

  it('offers a retry for server errors, timeouts, rate limits and lost connections', () => {
    for (const status of [0, 408, 429, 500, 503]) {
      expect(uploadOutcome(rejected('Try again', status))).toMatchObject({ kind: 'failed', retryable: true });
    }
    expect(uploadOutcome(new Error('Upload failed'))).toMatchObject({ kind: 'failed', retryable: true });
  });
});
