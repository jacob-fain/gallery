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
      expect(uploadOutcome(rejected('No', status))).toEqual({
        kind: 'failed',
        error: 'No',
        retryable: false,
        auto: false,
        status,
      });
    }
  });

  it('shows the server refusal of a HEIC file as it is, with no retry', () => {
    const message =
      "HEIC photos aren't supported yet. Export as JPEG (on iPhone: Settings > Camera > Formats > Most Compatible)";
    expect(uploadOutcome(rejected(message, 415))).toEqual({
      kind: 'failed',
      error: message,
      retryable: false,
      auto: false,
      status: 415,
    });
  });

  it('offers a retry for server errors, timeouts, rate limits and lost connections', () => {
    for (const status of [0, 408, 429, 500, 503]) {
      expect(uploadOutcome(rejected('Try again', status))).toMatchObject({ kind: 'failed', retryable: true });
    }
    expect(uploadOutcome(new Error('Upload failed'))).toMatchObject({ kind: 'failed', retryable: true });
  });

  it('retries by itself only what was lost on the way: no answer, timeouts, proxies and Cloudflare', () => {
    for (const status of [0, 408, 429, 499, 502, 503, 504, 520, 522, 524]) {
      expect(uploadOutcome(rejected('Lost', status))).toMatchObject({ kind: 'failed', retryable: true, auto: true });
    }
    // An error with no status is a request that never got an answer.
    expect(uploadOutcome(new Error('Upload failed'))).toMatchObject({ auto: true });
  });

  it('leaves a plain server error to the admin: it is usually the same on every try', () => {
    expect(uploadOutcome(rejected('Failed to upload photo', 500))).toEqual({
      kind: 'failed',
      error: 'Failed to upload photo',
      retryable: true,
      auto: false,
      status: 500,
    });
  });

  it('keeps the stored photo a 409 names, so a retry can tell its own earlier attempt', () => {
    const err = Object.assign(rejected('Already uploaded as a.jpg (needs review)', 409), {
      existing: { id: 'p1', gallery_id: 'g1' },
    });
    expect(uploadOutcome(err)).toEqual({
      kind: 'duplicate',
      note: 'Already uploaded as a.jpg (needs review)',
      existing: { id: 'p1', gallery_id: 'g1' },
    });
  });
});
